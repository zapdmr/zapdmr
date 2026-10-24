const assert=require('node:assert/strict');
const dgram=require('node:dgram');
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const fs=require('node:fs');const vm=require('node:vm');
const {BrandMeisterGateway}=require('../../dist/server/brandmeister-gateway.js');
const {terminalPacket,terminalHeader,ODTP}=require('../../dist/server/open-terminal.js');
const {DEFAULT_SETTINGS}=require('../../dist/server/types.js');
const wait=async(fn,timeout=3000)=>{const end=Date.now()+timeout;while(!fn()){if(Date.now()>end)throw new Error('Timed out waiting for expected state');await delay(10);}};
(async()=>{
  const socket=dgram.createSocket('udp4');await new Promise(resolve=>socket.bind(0,'127.0.0.1',resolve));
  const secret='isolated-fixture';const challenge=Buffer.from('12345678','hex');let peer,authenticated=false,dropSubscriptions=false,seq=0;
  const sent=[];const reply=(type,payload=Buffer.alloc(0))=>socket.send(terminalPacket(type,seq++,payload),peer.port,peer.address);
  socket.on('message',(packet,remote)=>{
    assert.equal(packet.toString('ascii',0,8),'REWIND01','ODTP never sends Homebrew/DMRD datagrams');peer=remote;
    const type=packet.readUInt16LE(8),payload=packet.subarray(18);sent.push({type,payload:Buffer.from(payload)});
    if(type===ODTP.keepalive){assert.equal(payload[4],0x21,'Open Terminal service, not SEA');authenticated?reply(0):reply(2,challenge);}
    if(type===ODTP.auth){if(payload.equals(createHash('sha256').update(challenge).update(secret).digest())){authenticated=true;reply(0);}else reply(1);}
    if(type===ODTP.cancel)reply(type);
    if(type===ODTP.subscribe&&!dropSubscriptions)reply(type,payload);
  });
  const gateway=new BrandMeisterGateway();const received=[];gateway.on('frame',frame=>received.push({id:frame.readUIntBE(8,3),words:gateway.receiveVoiceCodewords(frame)}));
  const settings={...DEFAULT_SETTINGS,radioProtocol:'odtp',callsign:'TEST1A',dmrId:'1234567',essid:'02',masterHost:'127.0.0.1',masterPort:socket.address().port,selectedTalkgroupId:91};
  const voice=(id,source=2345678)=>{reply(ODTP.header,terminalHeader(id,source));reply(ODTP.audio,Buffer.alloc(27,0x55));};
  try {
    // A: authenticate and receive selected TG before any PTT.
    assert.equal((await gateway.connect(settings,secret)).accepted,true);
    await wait(()=>gateway.status().reception.state==='ready');voice(91);await wait(()=>received.length===1);
    assert.equal(received[0].words.length,3);assert(received[0].words.every(word=>word.equals(Buffer.alloc(9,0x55))),'AMBE words survive transport framing');
    assert.equal(sent.some(p=>[ODTP.header,ODTP.audio,ODTP.terminator].includes(p.type)),false,'No automatic audio/header/kerchunk');
    // B/C/D: replace subscription; fast changes coalesce; old TG audio is rejected.
    gateway.selectReception(72426);await wait(()=>gateway.status().reception.state==='ready'&&gateway.status().reception.targetTalkgroupId===72426);
    voice(91);await delay(25);assert.equal(received.length,1);voice(72426);await wait(()=>received.length===2);
    gateway.selectReception(7244);gateway.selectReception(91);gateway.selectReception(72426);
    await wait(()=>gateway.status().reception.state==='ready'&&gateway.status().reception.targetTalkgroupId===72426);
    voice(7244);voice(91);await delay(25);assert.equal(received.length,2);voice(72426);await wait(()=>received.length===3);
    assert.equal(sent.filter(p=>p.type===ODTP.subscribe).some(p=>p.payload.readUInt32LE(4)===4000),false);
    // F: only explicit PTT sends voice packets, using the existing codec/framer.
    await delay(1750); // Local RX interlock expires before the explicit TX test.
    gateway.setAudioReady(true);assert.equal((await gateway.setPtt(true,72426,2)).accepted,true);
    for(let n=0;n<3;n++)assert.equal((await gateway.pushVoiceCodeword(Buffer.alloc(9,0x55))).accepted,true);
    await gateway.setPtt(false,72426);await wait(()=>sent.some(p=>p.type===ODTP.terminator));
    assert.deepEqual(sent.filter(p=>[ODTP.header,ODTP.audio,ODTP.terminator].includes(p.type)).map(p=>p.type),[ODTP.header,ODTP.audio,ODTP.terminator]);
    gateway.selectReception(2345678,'private');await wait(()=>gateway.status().reception.state==='ready');
    const privateSubscription=sent.filter(p=>p.type===ODTP.subscribe).at(-1).payload;
    assert.equal(privateSubscription.readUInt32LE(0),5);assert.equal(privateSubscription.readUInt32LE(4),1234567);
    reply(ODTP.header,terminalHeader(1234567,2345678,true));reply(ODTP.audio,Buffer.alloc(27,0x55));await wait(()=>received.length===4);
    voice(72426);await delay(25);assert.equal(received.length,4,'Group audio does not invade the selected private call');
    // E: a fresh authenticated session restores the selected subscription.
    await gateway.disconnect();authenticated=false;assert.equal((await gateway.connect({...settings,selectedTalkgroupId:72426},secret)).accepted,true);
    await wait(()=>gateway.status().reception.state==='ready');assert.equal(gateway.status().reception.targetTalkgroupId,72426);
    // G: missing subscription ACK is an error, never fictitious readiness.
    dropSubscriptions=true;gateway.selectReception(91);await wait(()=>gateway.status().reception.state==='error',6500);
    assert.equal(gateway.status().connected,true,'A subscription failure does not falsely close the authenticated transport');
    await gateway.disconnect();authenticated=false;assert.equal((await gateway.connect(settings,'incorrect-fixture')).accepted,false,'Authentication rejection surfaced');
    assert.equal(gateway.status().state,'error');
    // Protocol settings and UI status remain capability-aware.
    const context={window:{}};vm.runInNewContext(fs.readFileSync('web/radio-protocol.js','utf8'),context);const ui=context.window.ZapDMRProtocol;
    assert.equal(ui.normalize({serverType:'brandmeister',masterPort:62031}).masterPort,54006);
    assert.equal(ui.normalize({serverType:'other',masterPort:62031}).radioProtocol,'hbp');
    assert.equal(ui.normalize({radioProtocol:'hbp',masterPort:62031}).radioProtocol,'hbp');
    assert.equal(ui.reception({connected:true,protocol:'hbp'},{},91).state,'unsupported');
    assert.equal(ui.reception({connected:true,protocol:'odtp',reception:{targetTalkgroupId:91,state:'ready',message:'confirmed'}},{},72426).state,'subscribing');
    console.log('PASS ODTP A–G on isolated UDP master: auth, subscribe/cancel, AMBE RX before PTT, rapid switches, old-TG rejection, reconnect, explicit voice TX, missing ACK/auth errors, profile migration and truthful UI. Real BrandMeister/device audio remain unverified.');
  }finally{await gateway.disconnect();await new Promise(resolve=>socket.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
