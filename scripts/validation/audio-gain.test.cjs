const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {AudioSidecarClient,AudioSidecarMessage:M}=require('../../dist/server/audio-sidecar-client.js');
(async()=>{const pipe='\\\\.\\pipe\\ZapDMR.GainTest.'+crypto.randomUUID(),statuses=[];
 const client=await AudioSidecarClient.launch(path.resolve('native/build/audio-sidecar-vs2022/bin/ZapDMRAudio.exe'),['--pipe',pipe,'--assets-dir',path.resolve('assets/vocoder')],{pipeName:pipe,onStatus:message=>statuses.push(message),onSidecarError:error=>statuses.push('ERROR: '+error.message)});
 try{async function wait(match){const until=Date.now()+10000;while(Date.now()<until){if(statuses.some(match))return;await new Promise(r=>setTimeout(r,30));}throw Error('Status esperado ausente: '+statuses.join('; '));}
 await wait(s=>s.includes('ZAPDMR_AUDIO_READY'));statuses.length=0;
 const value=Buffer.alloc(2);value.writeUInt16LE(260);client.send(M.setTxGain,value);await wait(s=>s==='TX_GAIN_UPDATED');statuses.length=0;
 client.send(M.setRxVolume,value);await wait(s=>s==='RX_VOLUME_UPDATED');statuses.length=0;
 value.writeUInt16LE(261);client.send(M.setTxGain,value);await wait(s=>s.includes('COMMAND_ERROR'));statuses.length=0;
 client.send(M.setTxGain,Buffer.from([130]));await wait(s=>s==='TX_GAIN_UPDATED');
 console.log('PASS: real compiled Windows audio engine accepts TX/RX 260%, rejects 261%, and accepts legacy 130% control. Codec initialized; microphone, speakers and radio were not activated.');
 }finally{client.close(true);}
})().catch(error=>{console.error(error);process.exitCode=1;});
