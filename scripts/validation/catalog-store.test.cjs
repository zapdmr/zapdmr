const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('web/catalog-store.js', 'utf8'), context);
const store = context.window.ZapDMRCatalog;
const canonical = JSON.parse(fs.readFileSync('data/talkgroups-brasil.json', 'utf8'));
const web = JSON.parse(fs.readFileSync('web/talkgroups-brasil.json', 'utf8'));
const ids = rows => Array.from(rows, group => group.id);
const nationalIds = [724,915,7241,7242,7243,7244,7245,72411,72412,72413,72414,72415,72416,72417,72421,72422,72423,72424,72425,72426,72427,72428,72429,72431,72432,72433,72434,72441,72442,72443,72444,72451,72452,72453];
const worldIds = [91,92,93,94,95,204,206,208,214,222,228,235,260,262,268,302,310,334,404,420,440,450,460,505,515,655,722,730,732,734,748];
assert.equal(store.bundled.length, 65, 'Only the agreed national and worldwide presets are bundled');
assert.deepEqual(Array.from(store.categories), ['Nacionais','Mundiais']);
assert.deepEqual(canonical, web, 'Windows canonical catalog and Android web assets must agree');
assert.equal(JSON.stringify(store.bundled), JSON.stringify(store.normalize(web)), 'Offline fallback must contain the current complete catalog');
assert.equal(new Set(ids(store.bundled)).size, store.bundled.length, 'Each TG ID is unique');
assert(store.bundled.some(group => group.id === 915 && group.category === 'Nacionais'), 'Portuguese TG 915 belongs to Nacionais');
assert(store.bundled.some(group => group.id === 724 && group.category === 'Nacionais'));
assert.deepEqual(ids(store.bundled.filter(group => group.category === 'Mundiais')).sort((a,b) => a-b), worldIds.slice().sort((a,b) => a-b), 'Worldwide/continental/country presets match the exact agreed list');
assert.deepEqual(ids(store.bundled.filter(group => group.category === 'Nacionais')).sort((a,b) => a-b), nationalIds.slice().sort((a,b) => a-b), 'National presets include Portuguese, Brazilian regions and states');
for (const id of [2,8,905,724942,724943,724947,724262,724997,724999,4000]) assert(!store.bundled.some(group => group.id === id), `Extra TG ${id} must be added explicitly by the operator`);
assert(!store.bundled.some(group => group.category === 'Nacionais e mundiais'), 'Bundled national and worldwide categories must be separated');
for (const group of store.bundled) assert(['Nacionais','Mundiais'].includes(group.category), `Unexpected category ${group.category}`);
const groups = store.merge(store.bundled, [{id:'9990',name:'Teste',custom:true}, {id:'724', name:'Brasil'}]);
assert.equal(groups.length, store.bundled.length + 1);
assert.equal(groups.find(group => group.id === 9990).custom, true);
assert.equal(groups.filter(group => group.id === 724).length, 1);
const legacyInputs = [
  {id:724942,name:'Net pessoal',category:'Nacionais e mundiais',slot:2,kind:'group',custom:true},
  {id:900001,name:'TG guardada',category:'Regiões',slot:2,kind:'group',custom:true},
  {id:900002,name:'Outra TG guardada',category:'Estados',slot:1,kind:'group',custom:true},
  {id:905,name:'Português guardado',category:'Mundiais/Países',slot:2,kind:'group',custom:true},
  {id:724943,name:'Ponte guardada',category:'Redes externas',slot:2,kind:'group',custom:true},
  {id:4000,name:'Comando pessoal',category:'Especiais',slot:2,kind:'group',custom:true}
];
const legacy = store.merge(store.bundled, legacyInputs);
assert.equal(legacy.length, store.bundled.length + legacyInputs.length, 'Existing saved custom extras are not deleted with the preset cleanup');
for (const input of legacyInputs) {
  const saved = legacy.find(group => group.id === input.id);
  assert(saved, `Custom TG ${input.id} survives migration`);
  assert.equal(saved.name, input.name);assert.equal(saved.slot, input.slot);assert.equal(saved.kind, input.kind);assert.equal(saved.custom, true);
  assert.equal(saved.legacyCategory, input.category, 'The original category remains available for existing imports');
  assert(['Nacionais','Mundiais'].includes(saved.category));
}
assert.equal(legacy.find(group => group.id === 905).category, 'Mundiais');
assert.equal(legacy.find(group => group.id === 900001).category, 'Nacionais');
assert.equal(JSON.stringify(store.normalize(legacy)), JSON.stringify(legacy), 'Migration is stable across saving and reopening');
const serverSource = fs.readFileSync('src/server/index.ts', 'utf8');
const categorySource = serverSource.match(/const CUSTOM_TALKGROUP_CATEGORIES = new Set\((\[[\s\S]*?\])\);/)?.[1];
assert(categorySource, 'Windows custom category whitelist must be available');
const acceptedCategories = vm.runInNewContext(categorySource);
for (const value of ['Nacionais','Mundiais',...legacyInputs.map(group => group.category)]) assert(acceptedCategories.includes(value), `Windows saved/imported custom category ${value} remains accepted`);
assert.equal(store.normalize([{id:-1}, {id:'abc'}, {id:16777216}]).length, 0);
console.log(`PASS: ${store.bundled.length} matching Windows/Android/offline presets in two categories; exact national/world lists, custom migrations and deduplication preserved`);
