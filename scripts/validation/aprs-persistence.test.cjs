'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const net=require('node:net');
const os=require('node:os');
const path=require('node:path');
const {aprsBaseCallsign,aprsPasscode,automaticAprsAuthorized}=require('../../dist/server/aprs-auth.js');
const {AprsClient}=require('../../dist/server/aprs-client.js');

const waitFor=(emitter,predicate,timeout=7000)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{emitter.off('status',listener);reject(new Error('Tempo esgotado aguardando estado APRS.'));},timeout);
  const listener=value=>{if(!predicate(value))return;clearTimeout(timer);emitter.off('status',listener);resolve(value);};
  emitter.on('status',listener);
});
const listen=server=>new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));

(async()=>{
  assert.equal(aprsPasscode('N0CALL'),13023,'vetor público N0CALL');
  assert.equal(aprsPasscode('N0CALL-15'),13023,'SSID não participa do cálculo');
  assert.equal(aprsPasscode('test'),29939,'normalização independente de maiúsculas');
  assert.equal(aprsPasscode('PU5RZS'),19638,'vetor ZapDMR PU5RZS');
  assert.equal(aprsBaseCallsign(' pu5rzs-0 '),'PU5RZS');
  const verified={endpoint:'https://www.zapdmr.com.br',token:'fixture-session',account:{verified:true,whatsapp_verified:true,callsign:'PU5RZS',dmrId:'7240001'}};
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},verified,'PU5RZS-5'),true);
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},{...verified,account:{...verified.account,verified:undefined}},'PU5RZS'),true,'perfil oficial legado sem campo duplicado verified continua autorizado');
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},verified,'PY2ABC-5'),false,'não provisiona indicativo de terceiro');
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7249999'},verified,'PU5RZS'),true,'a conta autenticada é a fonte de verdade mesmo antes de selecionar o perfil de rádio correspondente');
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},{...verified,account:{...verified.account,verified:false}},'PU5RZS'),false,'cadastro explicitamente não verificado é bloqueado');
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},{...verified,account:{...verified.account,whatsapp_verified:false}},'PU5RZS'),false,'WhatsApp não verificado é bloqueado');
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},{...verified,account:{...verified.account,whatsapp_verified:false,email_verified:true}},'PU5RZS'),true,'e-mail confirmado preserva o passcode APRS automático');
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},{...verified,token:''},'PU5RZS'),false,'sessão ausente é bloqueada');
  assert.equal(automaticAprsAuthorized({callsign:'PU5RZS',dmrId:'7240001'},{...verified,endpoint:'https://example.invalid'},'PU5RZS'),false,'origem não oficial é bloqueada');

  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'zapdmr-aprs-'));
  let login='',packets=[];
  const server=net.createServer(socket=>{socket.write('# mock APRS-IS\r\n');let buffer='';socket.on('data',chunk=>{buffer+=chunk.toString('latin1');let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).replace(/\r$/,'');buffer=buffer.slice(at+1);if(line.startsWith('user ')){login=line;socket.write('# logresp PU5RZS verified, server MOCK\r\n');}else packets.push(line);}});});
  const port=await listen(server),client=new AprsClient(path.join(temp,'history.json'));
  const verifiedState=waitFor(client,value=>value.verified===true);
  await client.connect({callsign:'PU5RZS',host:'127.0.0.1',port,beacon:true,intervalMinutes:60},String(aprsPasscode('PU5RZS')));
  await verifiedState;
  assert.match(login,/^user PU5RZS pass 19638 vers ZapDMR 1\.5\.6-test\.1$/);
  client.position(-25.4,-49.2);client.beacon();await new Promise(resolve=>setTimeout(resolve,50));
  const beacons=packets.filter(line=>line.startsWith('PU5RZS>APZDMR,TCPIP*:='));assert.equal(beacons.length,1);assert.match(beacons[0],/^PU5RZS>APZDMR,TCPIP\*:=/);
  assert.equal(client.snapshot().state,'connected');assert.ok(client.snapshot().lastServerResponseAt);
  client.close();await close(server);

  let unverifiedPacket=false;
  const rejectServer=net.createServer(socket=>{socket.write('# mock APRS-IS\r\n');socket.once('data',()=>socket.write('# logresp PU5RZS unverified, server MOCK\r\n'));socket.on('data',chunk=>{if(chunk.toString('latin1').includes('TCPIP*'))unverifiedPacket=true;});});
  const rejectPort=await listen(rejectServer),rejected=new AprsClient(path.join(temp,'rejected.json'));
  const receiveOnly=waitFor(rejected,value=>value.state==='receive-only');
  await rejected.connect({callsign:'PU5RZS',host:'127.0.0.1',port:rejectPort,beacon:true,latitude:-25.4,longitude:-49.2},'1');await receiveOnly;
  assert.throws(()=>rejected.beacon(),/login verificado/);assert.equal(unverifiedPacket,false);
  rejected.close();await close(rejectServer);

  const bridge=fs.readFileSync(path.join(__dirname,'../../web/radio-bridge.js'),'utf8'),consoleJs=fs.readFileSync(path.join(__dirname,'../../web/radio-console.js'),'utf8'),service=fs.readFileSync(path.join(__dirname,'../../android/app/src/main/java/br/radio/zapdmr/AprsService.java'),'utf8');
  assert.match(bridge,/restoreAprs/);assert.match(consoleJs,/APRS-IS — LIGADO \/ DESLIGADO/);assert.match(consoleJs,/só será guardada após resposta verified/);assert.match(service,/AprsCredentialStore\.confirm/);assert.doesNotMatch(consoleJs,/id="rcAprsDisconnect"/);
  await fsp.rm(temp,{recursive:true,force:true});
  console.log('APRS persistence/authentication regression: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
