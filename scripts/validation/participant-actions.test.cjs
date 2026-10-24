const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.textContent='';this.open=false;this.listeners={};}
 append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this[k]=v;}addEventListener(k,v){this.listeners[k]=v;}
 querySelector(q){return q==='h2'?this.children.find(c=>c.tag==='h2'):this.children.find(c=>c.className===q.slice(1));}
 replaceChildren(...nodes){this.children=nodes;}showModal(){this.open=true;}close(){this.open=false;}
}
(async()=>{
 const dialogs=[],calls=[],cell=new Element('td'),power=new Element('button');cell.textContent='K1ABC';cell.dataset={participantName:'Alice',dmrId:'1234567'};
 const status={connected:true,pttReady:true};let isNative=false;
 const context={document:{body:{append:d=>dialogs.push(d)},createElement:t=>new Element(t),getElementById:()=>power,querySelectorAll:()=>[cell]},mobileAudio:{isAndroid:()=>isNative,quickExit:async()=>calls.push('nativeExit'),participantAction:async(c,a)=>calls.push([c,a])},gatewayStatus:status,mobilePttActive:false,mobilePttPending:false,stopTalkgroupScan:()=>calls.push('stopScan'),toast:s=>calls.push(s),window:{ZapDMRCommunity:{openParticipant:async(...args)=>calls.push(args)},open:(...args)=>calls.push(args)},navigator:{clipboard:{writeText:async s=>calls.push(s)}},callApi:async url=>{calls.push(url);return{ok:true,data:{}};},showStatus:()=>{}};
 vm.runInNewContext(fs.readFileSync('web/participant-actions.js','utf8'),context);
 assert.equal(cell.children[0].textContent,'K1ABC');cell.children[0].onclick();assert.equal(dialogs[0].querySelector('h2').textContent,'K1ABC — Alice');
 await dialogs[0].children[1].onclick();assert.deepEqual(calls.pop(),['K1ABC','1234567']);
 cell.children[0].onclick();await dialogs[0].children[2].onclick();assert.equal(calls.pop()[0],'https://www.qrz.com/db/K1ABC');
 cell.children[0].onclick();await dialogs[0].children[3].onclick();assert(calls.includes('K1ABC'));
 assert(context.window.ZapDMRParticipantActions.valid('HB9HJH'));assert(context.window.ZapDMRParticipantActions.valid('PY2ABC/P'));assert(!context.window.ZapDMRParticipantActions.valid('javascript:alert(1)'));
 context.mobilePttActive=true;power.onclick();assert(!dialogs[1].open);context.mobilePttActive=false;power.onclick();assert(dialogs[1].open);
 context.mobilePttActive=true;await dialogs[1].children[3].onclick();assert(!calls.includes('/api/disconnect'));
 context.mobilePttActive=false;await dialogs[1].children[3].onclick();assert(calls.includes('/api/disconnect'));assert(calls.includes('stopScan'));
 isNative=true;power.onclick();await dialogs[1].children[3].onclick();assert(calls.includes('nativeExit'));
 // Execute the actual directory search with identity matching, without network/accounts.
 const source=fs.readFileSync('web/community-chat.js','utf8');const search=source.slice(source.indexOf('async function search(query,expected){'),source.indexOf('\n    function reopen()',source.indexOf('async function search(query,expected){')));
 const events=[];const c={epoch:0,token:()=>true,clear:()=>{},report:s=>events.push(s),AbortController,remote:async()=>({user:c.user}),dialog:{open:true},peer:null,el:()=>({}),renderPeer:()=>{},renderPending:()=>{},start:()=>events.push('history'),window:{ZapDMRCommunity:{privateConfig:()=>({account:{id:'self'}})}}};vm.createContext(c);vm.runInContext(search+';this.lookup=search;',c);
 c.user={id:'peer',callsign:'K1ABC',dmrId:'1234567'};await c.lookup('1234567',{callsign:'K1ABC',dmrId:'1234567'});assert(events.includes('history'));
 events.length=0;c.user={id:'wrong',callsign:'K2XYZ',dmrId:'1234567'};await c.lookup('1234567',{callsign:'K1ABC',dmrId:'1234567'});assert(!events.includes('history'));assert.equal(c.peer,null);
 events.length=0;c.user=null;await c.lookup('K1ABC',{callsign:'K1ABC'});assert(!events.includes('history'));assert(events.some(s=>s.includes('ainda não possui cadastro')));
 console.log('PASS participant menu, QRZ, clipboard, matched/missing/mismatched chat account, power confirmation and TX refusal (UI harness; no physical device).');
})().catch(e=>{console.error(e);process.exitCode=1;});
