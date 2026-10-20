const path=require('node:path'),fs=require('node:fs/promises');
const {BrandMeisterGateway}=require('../../dist/server/brandmeister-gateway');
const {AudioSidecarClient,AudioSidecarMessage:M}=require('../../dist/server/audio-sidecar-client');
const {loadWindowsSecret}=require('../../dist/server/secret-store');
(async()=>{
 const root=path.resolve(__dirname,'../..'),data=path.join(process.env.APPDATA,'ZapDMR');
 let settings=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')),id='default';
 try{const profiles=JSON.parse(await fs.readFile(path.join(data,'profiles.json'),'utf8'));id=profiles.activeProfileId||'default';settings=profiles.profiles.find(p=>p.id===id)?.settings||settings}catch{}
 const password=await loadWindowsSecret(path.join(data,'profile-secrets',id+'.dpapi'))||await loadWindowsSecret(path.join(data,'hotspot-password.dpapi'));
 if(!password)throw Error('Senha protegida não disponível para diagnóstico.');
 const pipe='\\\\.\\pipe\\ZapDMR.LinkDiagnostic.'+process.pid;
 const gateway=new BrandMeisterGateway();let client,frames=0,voice=0,first=false;const destinations={};
 try{
 client=await AudioSidecarClient.launch(path.join(root,'native/build/audio-sidecar-vs2022/bin/ZapDMRAudio.exe'),['--assets-dir',path.join(root,'assets/vocoder'),'--pipe',pipe],{pipeName:pipe});
 const words=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Timeout silêncio')),10000);client.on('message',m=>{if(m.type===M.silenceFec){clearTimeout(t);resolve(Array.from({length:18},(_,i)=>m.payload.subarray(i*9,i*9+9)))}});client.send(M.encodeSilence,Buffer.from([18]));});
 gateway.on('frame',p=>{frames++;const tg=p.readUIntBE(8,3);destinations[tg]=(destinations[tg]||0)+1;voice+=gateway.receiveVoiceCodewords(p).length;if(!first){first=true;console.log('[RX REAL] TG '+p.readUIntBE(8,3)+' origem '+p.readUIntBE(5,3)+' bytes '+p.length);}});
 const connected=await gateway.connect({...settings,essid:'04'},password);console.log('[HBP diagnóstico ESSID 04] '+connected.code);if(!connected.accepted)throw Error(connected.message);
 console.log('[UNLINK] '+JSON.stringify(await gateway.sendDisconnectTalkgroup(1,words)));
 await new Promise(r=>setTimeout(r,3000));
 console.log('[LINK TG91] '+JSON.stringify(await gateway.sendTalkgroupBurst(91,1,words)));
 await new Promise(r=>setTimeout(r,45000));
 console.log('[RESULTADO] '+JSON.stringify({quadrosDMRD:frames,porDestino:destinations,codewordsVoz:voice,microfoneCapturado:false}));
 }finally{await gateway.disconnect();client?.close(true);}
})().catch(e=>{console.error(e.message);process.exitCode=1});
