const assert=require('node:assert/strict');
const {Scan,HoldPtt}=require('../../web/car-scan');
(async()=>{
 let now=0,calls=[];const scan=new Scan({tune:async id=>{calls.push(id)},now:()=>now});
 let s={connected:true,protocol:'odtp',rxBusy:false,txActive:false};
 scan.configure({ids:[724,72444,7241],priority:724,holdMs:4000,dwellMs:2000});await scan.start(s);assert.deepEqual(calls,[724]);assert.equal(scan.state,'SCANNING');assert.equal(scan.lastRx,null);
 now=1500;await scan.tick(s);assert.equal(calls.length,1,'must wait for server ACK');
 s={...s,receptionTarget:724,receptionState:'ready'};await scan.tick(s);
 assert.equal(scan.voice({destination:72444,source:1234567}),false,'unsubscribed TG is not local RX');
 assert.equal(scan.voice({destination:724,source:1234567}),true);s.rxBusy=true;now=9000;await scan.tick(s);assert.equal(calls.length,1,'hold throughout actual RX');assert.equal(scan.state,'RX_ACTIVE');
 s.rxBusy=false;await scan.tick(s);assert.equal(scan.state,'HOLD_AFTER_RX');now+=3999;await scan.tick(s);assert.equal(calls.length,1);now++;await scan.tick(s);assert.deepEqual(calls,[724,72444]);
 // A second active TG cannot mix into the single selected receive lane.
 assert.equal(scan.voice({destination:724,source:2222222}),false);
 s={...s,receptionTarget:72444,receptionState:'awaiting-traffic'};await scan.tick(s);now+=2000;await scan.tick(s);assert.deepEqual(calls,[724,72444,724]);
 s={...s,receptionTarget:724};await scan.tick(s);now+=2000;await scan.tick(s);assert.deepEqual(calls,[724,72444,724,7241],'priority alternates without preempting RX');
 s.txActive=true;now+=5000;await scan.tick(s);assert.equal(scan.state,'TX_ACTIVE');assert.equal(calls.length,4);s.txActive=false;await scan.tick(s);assert.equal(scan.state,'HOLD_AFTER_RX');now+=4000;s.connected=false;await scan.tick(s);assert.equal(scan.state,'RECONNECTING');assert.equal(calls.length,4);s.connected=true;await scan.tick(s);assert.equal(calls.length,5,'resubscribe only after reconnection');
 await scan.tick({...s,xlx:true});assert.equal(scan.state,'ERROR');assert.equal(scan.wanted,false);
 assert.throws(()=>scan.start({...s,protocol:'hbp'}));scan.stop();assert.equal(scan.state,'IDLE');
 // Rejected/raced idle check defers without claiming a subscription or RX.
 let deferred=new Scan({tune:async()=>({deferred:true}),now:()=>now});deferred.configure({ids:[724]});await deferred.start(s);assert.equal(deferred.tg,0);assert.equal(deferred.lastRx,null);
 let resolve;const pending=new Promise(r=>resolve=r);let starts=0,stops=0;
 const hold=new HoldPtt({start:async()=>{starts++;await pending;},stop:async()=>{stops++;}});
 const press=hold.down(1);assert.equal(await hold.down(2),false);await hold.up(1);assert.equal(stops,1);resolve();await press;assert.equal(stops,2,'late start is stopped again');assert.equal(starts,1);assert.equal(hold.pointer,null);
 let safe=new HoldPtt({start:async()=>{starts++;},stop:async()=>{stops++;}});await safe.down(3);await safe.up(3);assert.equal(safe.pointer,null);await safe.down(4);await safe.up();assert.equal(safe.pointer,null,'pointercancel/focus/device loss all use unconditional release');
 const timeout=new Scan({tune:async()=>{},now:()=>now});timeout.configure({ids:[724]});await timeout.start(s);now+=12001;await timeout.tick({...s,receptionState:'subscribing'});assert.equal(timeout.state,'ERROR');assert.equal(timeout.wanted,false);
 console.log('PASS car state machine: ODTP-only sequential subscriptions, ACK gate, actual TG/source RX only, 4s hold, priority/collisions, TX/reconnect freezes, XLX isolation, timeout, no global activity evidence; momentary PTT cancellation and late-start safety. Local simulation only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
