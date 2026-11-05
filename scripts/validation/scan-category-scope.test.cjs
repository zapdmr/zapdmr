const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { scanTarget } = require('../../web/talkgroup-activity.js');

const catalogContext = { window: {} };
vm.runInNewContext(fs.readFileSync('web/catalog-store.js', 'utf8'), catalogContext);
const bundled = catalogContext.window.ZapDMRCatalog.bundled;
const app = fs.readFileSync('web/app.js', 'utf8');
const start = app.indexOf('function categoryName');
const end = app.indexOf('function renderQuickTalkgroups');
assert(start >= 0 && end > start, 'Scan category helpers must remain available');

const helperContext = { window: { ZapDMRCatalog: { bundled } } };
vm.runInNewContext(`let scanCatalogScope = 'national';\n${app.slice(start, end)}\nthis.scanApi = {
  catalogCategory, matchesScanCatalogScope, normalizeScanCatalogScope, scanScopeCategory
};`, helperContext);
const scope = helperContext.scanApi;

const national = bundled.find((group) => group.id === 724);
const world = bundled.find((group) => group.id === 91);
const unclassified = catalogContext.window.ZapDMRCatalog.normalize([
  { id: 72499, name: 'Legada', category: 'Especiais', custom: true }
])[0];
assert.equal(scope.catalogCategory(national), 'Nacionais');
assert.equal(scope.catalogCategory(world), 'Mundiais');
assert.equal(unclassified.legacyCategory, 'Especiais', 'Legacy category metadata must remain preserved');
assert.equal(scope.catalogCategory(unclassified), null, 'TG without real catalog classification must not be guessed from its number');

const groups = [national, world, unclassified];
const eligible = (selectedScope) => groups.filter((group) => scope.matchesScanCatalogScope(group, selectedScope));
assert.deepEqual(eligible('all').map((group) => group.id), [724, 91, 72499]);
assert.deepEqual(eligible('national').map((group) => group.id), [724]);
assert.deepEqual(eligible('world').map((group) => group.id), [91]);

const now = 1_000_000;
const activity = {
  724: { lastActivityAt: now - 2_000 },
  91: { lastActivityAt: now - 1_000 }
};
assert.equal(scanTarget(eligible('national'), activity, 91, 0, now).id, 724,
  'National scan must not select an active world TG');
assert.equal(scanTarget(eligible('world'), activity, 724, 0, now).id, 91,
  'World scan must not select an active national TG');

assert.match(app, /const scopedGroups = groups\.filter\(group => matchesScanCatalogScope\(group\)\)/,
  'Operational scan pool must use the effective category scope');
assert.doesNotMatch(app, /const pool=.*filteredCatalogGroups/,
  'Operational scan pool must not depend on the visual list/search filter');
assert.equal((app.match(/setScanCatalogScope\(/g) || []).length >= 4, true,
  'Home and Connection category controls must share one scan scope setter');
assert.match(app, /gatewayStatus\.rxBusy[\s\S]*Scan pausado durante a recepção/,
  'Category changes must not retune while reception is active');
assert.match(app, /nenhuma TG elegível em/,
  'An empty category must not fall back to another scan category');

console.log('PASS: shared category scope constrains the operational scan pool without numeric heuristics or visual-search leakage');
