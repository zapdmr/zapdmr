const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {startServer}=require('../../dist/server/index');
const {loadWindowsSecret}=require('../../dist/server/secret-store');
(async()=>{
 const root=await fs.mkdtemp(path.resolve('work/profiles147-'));
 let server;const open=async()=>server=await startServer({userDataDir:root,port:0,udpPort:0,lastHeardUrl:'ws://127.0.0.1:9',staticDir:path.resolve('web'),talkgroupsFile:path.resolve('data/talkgroups-brasil.json')});
 const api=async(route,body,method='POST')=>{const r=await fetch(server.url+route,body===undefined?{}:{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  await open();const initial=(await api('/api/settings')).data;const bmId=initial.profileId;
  const bm={...initial,callsign:'TEST1A',dmrId:'1234567',essid:'02',masterHost:'bm.example.invalid',autoConnectOnStartup:false,autoReconnect:false,txGainPercent:130,rxVolumePercent:160};
  assert.equal((await api('/api/settings',{...bm,profileName:'BrandMeister fixture',hotspotPassword:'fixture-bm-secret'})).status,200);
  const created=await api('/api/profiles',{name:'XLX026 fixture',settings:{...bm,serverType:'other',xlxModule:'C',radioProtocol:'hbp',userUrl:'C',hbpOptions:'',masterHost:'xlx026.net',masterPort:62030,essid:'',defaultSlot:2,selectedTalkgroupId:4003}});
  assert.equal(created.status,201);const xlxId=created.data.activeProfileId;assert.equal(created.data.settings.passwordConfigured,false,'New server never inherits BM secret');
  assert.equal((await api('/api/settings',{...created.data.settings,hotspotPassword:'fixture-xlx-secret'})).status,200);
  assert.equal((await loadWindowsSecret(path.join(root,'profile-secrets',xlxId+'.dpapi'))),'fixture-xlx-secret');
  assert.equal((await loadWindowsSecret(path.join(root,'profile-secrets',bmId+'.dpapi'))),'fixture-bm-secret');
  const restored=await api('/api/profiles/'+bmId+'/activate',{});assert.equal(restored.data.settings.masterHost,bm.masterHost);assert.equal(restored.data.settings.rxVolumePercent,160);assert.equal(restored.data.settings.passwordConfigured,true);assert.equal((await api('/api/status')).data.brandmeister.protocol,'odtp');
  const active=await api('/api/profiles/'+xlxId+'/activate',{});assert.equal(active.data.settings.essid,'');assert.equal(active.data.settings.defaultSlot,2);assert.equal(active.data.settings.selectedTalkgroupId,4003);assert.equal(active.data.settings.userUrl,'C');assert.equal((await api('/api/status')).data.brandmeister.xlxModule,'C');
  await server.close();server=null;await open();const reopened=(await api('/api/settings')).data;assert.equal(reopened.profileId,xlxId);assert.equal(reopened.xlxModule,'C');assert.equal(reopened.passwordConfigured,true);assert.equal((await api('/api/profiles')).data.profiles.length,2);
  const raw=await fs.readFile(path.join(root,'profiles.json'),'utf8');assert(!raw.includes('fixture-bm-secret')&&!raw.includes('fixture-xlx-secret'),'Credentials never enter plain profile JSON');
  console.log('PASS Windows real DPAPI + isolated local API: separate profile secrets, XLX optional ESSID/TS2/4003/URL, BM settings unchanged, clean activation, persistence after server restart, no plaintext secrets in profiles.json. No real radio connection.');
 }finally{await server?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
