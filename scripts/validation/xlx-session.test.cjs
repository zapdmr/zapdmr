const assert=require('node:assert/strict');
const dgram=require('node:dgram');
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {BrandMeisterGateway}=require('../../dist/server/brandmeister-gateway');
const {DEFAULT_SETTINGS}=require('../../dist/server/types');
const {buildVoiceBurst}=require('../../dist/server/dmr-voice-framer');
const wait=async(fn)=>{for(let n=0;n<200;n++){if(fn())return;await delay(10);}throw Error('Fixture timeout');};
(async()=>{
 const master=dgram.createSocket('udp4');await new Promise(r=>master.bind(0,'127.0.0.1',r));
 const sent=[],seed=Buffer.from([1,2,3,4]),secret='fixture-only';let peer,phase=0;
 const reply=b=>master.send(b,peer.port,peer.address);
 master.on('message',(packet,remote)=>{
  peer=remote;sent.push(Buffer.from(packet));const tag=packet.toString('ascii',0,4);
  if(tag==='RPTL'){phase=1;reply(Buffer.concat([Buffer.from('RPTACK'),seed]));}
  if(tag==='RPTK'){assert.equal(phase,1);assert.equal(packet.length,40);assert(packet.subarray(8).equals(createHash('sha256').update(seed).update(secret).digest()));phase=2;reply(Buffer.from('RPTACK'));}
  if(tag==='RPTC'&&packet.length===302){assert.equal(phase,2);phase=3;reply(Buffer.from('RPTACK'));}
 });
 const g=new BrandMeisterGateway(),frames=[];g.on('frame',p=>frames.push(p));
 const settings={...DEFAULT_SETTINGS,callsign:'TEST1A',dmrId:'1234567',essid:'',serverType:'other',radioProtocol:'hbp',xlxModule:'C',userUrl:'C',hbpOptions:'fixture=1',defaultSlot:2,selectedTalkgroupId:4003,masterHost:'127.0.0.1',masterPort:master.address().port};
 const incoming=(tg,flags=0x90,stream=123)=>{const p=Buffer.alloc(55);p.write('DMRD');p.writeUIntBE(2345678,5,3);p.writeUIntBE(tg,8,3);p[15]=flags;p.writeUInt32BE(stream,16);buildVoiceBurst([Buffer.alloc(9,0x55),Buffer.alloc(9,0x55),Buffer.alloc(9,0x55)],true,1,{destinationId:tg,sourceId:2345678,callType:'group',sequence:0}).copy(p,20);reply(p);return p;};
 try{
  assert.equal((await g.connect(settings,secret)).accepted,true);await wait(()=>sent.some(p=>p.toString('ascii',0,4)==='RPTO'));
  const rptc=sent.find(p=>p.length===302);assert.equal(rptc.readUInt32BE(4),1234567);assert.equal(rptc[97],50);assert.equal(rptc.toString('ascii',98,222).trim(),'C');
  assert.equal(sent.some(p=>p.toString('ascii',0,4)==='DMRD'),false,'Login is passive, no PTT or TG4000');
  assert.equal(g.status().reception.state,'awaiting-audio');g.setAudioReady(true);
  for(const tg of [9,4003,6]){const p=incoming(tg);await wait(()=>frames.some(f=>f.readUIntBE(8,3)===tg));assert.equal(g.isSelectedVoicePacket(p,4003),true);assert.equal(g.receiveVoiceCodewords(p).length,3);}
  assert.equal(g.status().rxBusy,true);assert.equal((await g.setPtt(true,4003,2)).code,'RX_BUSY');
  const count=frames.length;incoming(9,0x10);incoming(9,0xd0);await delay(40);assert.equal(frames.length,count,'TS1 and private frames are excluded');
  incoming(9,0xa2);await delay(80);assert.equal((await g.setPtt(true,4003,2)).code,'RX_BUSY');await delay(460);
  assert.equal(g.status().rxBusy,false);assert.equal((await g.setPtt(true,4003,1)).code,'INVALID_XLX_TARGET');
  assert.equal((await g.setPtt(true,4003,2)).accepted,true);
  for(let n=0;n<3;n++)assert.equal((await g.pushVoiceCodeword(Buffer.alloc(9,0x55))).accepted,true);
  assert.equal((await g.setPtt(false,4003,2)).accepted,true);await wait(()=>sent.some(p=>p.length===55&&(p[15]&0x3f)===0x22));
  const tx=sent.filter(p=>p.toString('ascii',0,4)==='DMRD');assert(tx.every(p=>p.readUIntBE(8,3)===4003&&(p[15]&0x80)!==0));assert.deepEqual(tx.map(p=>p[15]&0x3f),[0x21,0x10,0x22]);
  await g.disconnect();await wait(()=>sent.some(p=>p.toString('ascii',0,5)==='RPTCL'));
  assert.equal(g.status().rxBusy,false);assert.equal(g.status().connected,false);
  phase=0;assert.equal((await g.connect({...settings,essid:'02',xlxModule:undefined,hbpOptions:'',defaultSlot:1,selectedTalkgroupId:724},secret)).accepted,true);
  const latest=sent.filter(p=>p.length===302).at(-1);assert.equal(latest.readUInt32BE(4),123456702);assert.equal(latest.toString('ascii',98,222).trim(),'C');
  const other=incoming(9);await delay(30);assert.equal(g.isSelectedVoicePacket(other,724),false,'XLX permissive routing does not leak into normal HBP');
  console.log('PASS XLX isolated IPv4 UDP: RPTL/RPTK/RPTC/RPTO, base ID, URL C, TS2, passive login, routed AMBE RX, RX interlock + 500 ms, explicit TX/terminator, RPTCL, normal HBP isolation. No real RF audio asserted.');
 }finally{await g.disconnect();await new Promise(r=>master.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
