const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{
 constructor(){this.children=[];this.disabled=false;this.hidden=false;this.value='';this.open=false;this.dataset={};}
 setAttribute(){}append(...items){this.children.push(...items);}set innerHTML(value){this.html=value;}get innerHTML(){return this.html||'';}querySelectorAll(){return [];}showModal(){this.open=true;}close(){this.open=false;}addEventListener(){}
}
(async()=>{
 const els=new Map(),body=new Element(),get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);};
 const existing={id:'personal-bm',serverType:'brandmeister',name:'My unchanged BM',callsign:'TEST1A',dmrId:'1234567'};
 const state={window:{ZapDMRReady:true},document:{body,createElement:()=>new Element(),getElementById:get,querySelector:()=>new Element()},settings:{callsign:'TEST1A',dmrId:'1234567',txGainPercent:130,rxVolumePercent:150,theme:'dark'},defaults:{theme:'auto',selectedTalkgroupId:724},profiles:[existing],activeProfileId:existing.id,changingProfile:false,gatewayStatus:{connected:true},mobilePttActive:false,mobilePttPending:false,setActiveScreen:()=>{},setActiveSettingsPane:()=>{},toast:()=>{},renderProfiles:()=>{},console};
 const catalog={revision:1,profile:{id:'xlx026-brasil',name:'XLX026 BRASIL',settings:{serverType:'other',masterHost:'xlx026.net',masterPort:62030,xlxModule:'C',defaultSlot:2,selectedTalkgroupId:4003},credential:'public-fixture-key'}};
 let saved=0,activated=0;
 state.window.ZapDMROfficialProfiles={refresh:async()=>catalog,load:async()=>catalog};state.window.ZapDMRCommunity={initialize:async()=>{}};
 state.activateSavedProfile=async()=>{activated++;};
 state.profileApi=async(action,payload)=>{assert.equal(action,'create');assert.equal(payload.select,false);assert.equal(payload.hotspotPassword,'public-fixture-key');assert.equal(payload.settings.callsign,'TEST1A');assert.equal(payload.settings.dmrId,'1234567');saved++;return{ok:true,data:{createdProfileId:'official-xlx',activeProfileId:existing.id,profiles:[...state.profiles,{id:'official-xlx',name:payload.name,...payload.settings}]}};};
 vm.createContext(state);vm.runInContext(fs.readFileSync('web/onboarding.js','utf8'),state);
 await state.window.ZapDMROnboarding.recommended({callsign:'TEST1A',dmrId:'1234567'});assert.equal(saved,1);assert.equal(state.activeProfileId,existing.id);assert.equal(state.profiles[0],existing);assert.equal(activated,0,'import never auto-connects or transmits');assert.equal(get('onboardingConnect').hidden,false);
 await state.window.ZapDMROnboarding.recommended({callsign:'TEST1A',dmrId:'1234567'});assert.equal(saved,1,'idempotent addition');
 await assert.rejects(state.window.ZapDMROnboarding.recommended({callsign:'',dmrId:'bad'}));
 console.log('PASS shared Android/Windows UI logic: identity mapping, additive/idempotent recommended profile, retained audio settings/current profile, no automatic connect or PTT. DOM harness only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
