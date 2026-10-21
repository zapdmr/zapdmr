const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
  constructor(){this.dataset={};this.attributes={};this.children=[];this.value='';this.textContent='';this.open=false;this.replacements=0;}
  setAttribute(key,value){this.attributes[key]=value;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;this.replacements++;}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
const context=vm.createContext({document:{createElement:()=>new Element(),querySelectorAll:()=>[]},$:el,
  groups:[{id:724,name:'Brasil Nacional',category:'Nacionais'},{id:91,name:'Mundial / World-wide',category:'Mundiais'}],
  settings:{selectedTalkgroupId:724},quickCatalogScope:'all',activity:true,
  catalogCategory:g=>g.category,hasRecentActivity:()=>context.activity,selected:null,
  selectGroup:id=>context.selected=id,
});
context.groupSelected=()=>context.groups.find(g=>g.id===context.settings.selectedTalkgroupId);
const source=fs.readFileSync('web/app.js','utf8');
vm.runInContext(source.slice(source.indexOf('function renderQuickTalkgroups()'),source.indexOf('function hasRecentActivity(')),context);
vm.runInContext(source.slice(source.indexOf('function updateQuickTalkgroupIndicators()'),source.indexOf('function updateActivityDots()')),context);
vm.runInContext('openQuickTalkgroupPicker()',context);
const list=el('#quickTalkgroupOptions'),original=list.children.slice();
assert.equal(list.replacements,1);
list.scrollTop=140;
for(let i=0;i<120;i++){
  context.activity=i%2===0;context.settings.selectedTalkgroupId=i%2?91:724;
  vm.runInContext('renderQuickTalkgroups(); updateQuickTalkgroupIndicators()',context);
}
assert.equal(list.replacements,1,'activity and selection updates must never rebuild an open picker');
assert.equal(list.scrollTop,140,'background updates must preserve scroll position');
assert.equal(list.children[0],original[0],'the same TG stays under the finger');
assert.equal(original[0].attributes['aria-pressed'],'true','opening selection remains a stable snapshot');
context.groups.reverse();original[1].onclick();
assert.equal(context.selected,91,'tap still targets the ID originally shown despite catalog reorder');
assert.equal(el('#quickTalkgroupDialog').open,false);
console.log('PASS: 120 live activity/selection updates preserve rows, scroll, snapshot and tapped TG. No radio or network calls.');
