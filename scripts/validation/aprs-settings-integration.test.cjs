'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const net=require('node:net');
const os=require('node:os');
const path=require('node:path');
const {startServer}=require('../../dist/server/index.js');
const {loadWindowsSecret}=require('../../dist/server/secret-store.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'zapdmr-aprs-settings-'));let app;
 const aprs=net.createServer(socket=>{socket.write('# mock APRS-IS\r\n');socket.on('data',data=>{if(data.toString('latin1').startsWith('user '))socket.write('# logresp PU5RZS verified, server MOCK\r\n');});});
 await new Promise((resolve,reject)=>aprs.once('error',reject).listen(0,'127.0.0.1',resolve));const aprsPort=aprs.address().port;
 const open=async()=>app=await startServer({userDataDir:root,port:0,udpPort:0,lastHeardUrl:'ws://127.0.0.1:9',staticDir:path.resolve('web'),talkgroupsFile:path.resolve('data/talkgroups-brasil.json')});
 const api=async(route,body,method=body===undefined?'GET':'POST')=>{const response=await fetch(app.url+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
 try{
  await open();const initial=(await api('/api/settings')).data;
  await api('/api/community-profile',{phone:'+5541999999999',endpoint:'https://www.zapdmr.com.br',token:'fixture-session',account:{whatsapp_verified:true,callsign:'PU5RZS',dmrId:'7240001'}});
  const enabled={...initial,callsign:'PU5RZS',dmrId:'7240001',autoConnectOnStartup:false,autoReconnect:false,console:{...(initial.console||{}),aprs:{enabled:true,callsign:'',ssid:0,host:'127.0.0.1',port:aprsPort,messages:true,positionEnabled:false,intervalMinutes:5,smartBeaconing:false,symbol:'['}}};
  assert.equal((await api('/api/settings',enabled)).status,200);
  assert.equal((await api('/api/aprs/connect',{config:{callsign:'PU5RZS',host:'127.0.0.1',port:aprsPort}})).status,200);
  for(let i=0;i<30;i++){const status=(await api('/api/aprs')).data;if(status.verified&&status.credentialConfigured)break;await delay(100);}
  const verified=(await api('/api/aprs')).data;assert.equal(verified.verified,true);assert.equal(verified.credentialConfigured,true);assert.equal(verified.credentialSource,'automatic');
  const secretPath=path.join(root,'profile-secrets',initial.profileId+'.aprs.dpapi');const protectedSecret=await fs.readFile(secretPath,'utf8');assert(!protectedSecret.includes('19638'));assert.equal(JSON.parse(await loadWindowsSecret(secretPath)).passcode,'19638');
  const backup=(await api('/api/backup')).data;assert.equal(backup.version,3);assert.ok(backup.profiles[0].protectedAprsCredential);
  await app.close();app=null;await open();const reopened=(await api('/api/settings')).data;assert.equal(reopened.console.aprs.enabled,true);assert.equal(reopened.console.aprs.ssid,0);
  assert.equal((await api('/api/aprs/connect',{config:{callsign:'PU5RZS',host:'127.0.0.1',port:aprsPort}})).status,200,'credencial recuperada sem formulário');
  assert.equal((await api('/api/aprs/connect',{config:{callsign:'PU5RZS',host:'127.0.0.1',port:aprsPort},manualPasscode:'12345'})).status,200);
  for(let i=0;i<30;i++){const status=(await api('/api/aprs')).data;if(status.verified&&status.credentialSource==='manual')break;await delay(100);}
  assert.equal((await api('/api/aprs')).data.credentialSource,'manual','passcode manual confirmado substitui a credencial do perfil');
  await app.close();app=null;await open();
  assert.equal((await api('/api/aprs/connect',{config:{callsign:'PU5RZS',host:'127.0.0.1',port:aprsPort}})).status,200,'passcode manual protegido é recuperado após reiniciar');
  assert.equal(JSON.parse(await loadWindowsSecret(secretPath)).passcode,'12345');
  const reopenedManual=(await api('/api/settings')).data;
  const disabled={...reopenedManual,console:{...reopenedManual.console,aprs:{...reopenedManual.console.aprs,enabled:false}}};assert.equal((await api('/api/settings',disabled)).status,200);await api('/api/aprs/disconnect',{});
  await app.close();app=null;await open();assert.equal((await api('/api/settings')).data.console.aprs.enabled,false,'desligado permanece desligado');assert.equal((await api('/api/aprs')).data.state,'disconnected');
  console.log('PASS APRS Windows persistence: automatic legacy authorization, protected automatic/manual passcodes, enabled/disabled restart, stored reconnect, SSID 0 and backup v3.');
 }finally{await app?.close();await new Promise(resolve=>aprs.close(resolve));await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
