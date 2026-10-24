/* One subscribed group at a time. No global Last Heard entry is RX evidence. */
((root,factory)=>{const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZapDMRCarLogic=api;})(typeof window!=='undefined'?window:globalThis,()=>{
 class Scan {
  constructor({tune,changed=()=>{},now=()=>Date.now()}){this.tune=tune;this.changed=changed;this.now=now;this.state='IDLE';this.wanted=false;this.epoch=0;this.pending=false;this.tg=0;this.lastRx=null;this.options={ids:[],priority:0,holdMs:4000,dwellMs:2500};this.status={};this.cursor=0;this.priorityNext=true;}
  configure(options){if(this.wanted)throw Error('Pare o scan antes de configurar.');const ids=[...new Set((options.ids||[]).map(Number).filter(n=>Number.isInteger(n)&&n>0&&n<=0xffffff&&n!==4000))];if(!ids.length||ids.length>64)throw Error('Escolha entre 1 e 64 TGs para monitorar.');this.options={ids,priority:ids.includes(Number(options.priority))?Number(options.priority):0,holdMs:Math.max(500,Math.min(30000,Number(options.holdMs)||4000)),dwellMs:Math.max(1500,Math.min(15000,Number(options.dwellMs)||2500))};}
  snapshot(){return{state:this.state,wanted:this.wanted,target:this.tg,observed:this.lastRx,error:this.error||'',waitingAck:!!this.awaitAck};}
  emit(state=this.state){this.state=state;this.changed(this.snapshot());}
  start(status){if(status.protocol!=='odtp'||status.xlx||status.privateCall)throw Error('Scan requer uma sessão DMR ODTP de grupo. HBP/XLX não oferecem este scan.');if(!this.options.ids.length)throw Error('Configure os TGs antes de iniciar.');this.wanted=true;this.epoch++;this.tg=0;this.lastRx=null;this.dwellUntil=0;this.holdUntil=0;this.error='';this.awaitAck=false;this.status=status;this.emit(status.connected?'SCANNING':'RECONNECTING');return this.tick(status);}
  stop(){this.wanted=false;this.epoch++;this.awaitAck=false;this.emit('IDLE');}
  voice({destination,source,callType='group',callsign=''}){if(!this.wanted||callType!=='group'||Number(destination)!==this.tg||!Number.isInteger(Number(source))||Number(source)<1||Number(source)>0xffffff||this.status.txActive)return false;this.lastRx={tg:this.tg,source:Number(source),callsign:String(callsign).slice(0,16),at:this.now()};this.awaitAck=false;this.emit('RX_ACTIVE');return true;}
  choose(){const {ids,priority}=this.options;if(priority&&this.priorityNext){this.priorityNext=false;return priority;}const others=ids.filter(id=>id!==priority);if(!others.length)return priority||ids[0];const id=others[this.cursor++%others.length];this.priorityNext=!!priority;return id;}
  fail(message){this.wanted=false;this.error=message;this.epoch++;this.emit('ERROR');}
  async tick(status){this.status=status;if(!this.wanted)return;
   const now=this.now();
   if(status.protocol!=='odtp'||status.xlx||status.privateCall){this.fail('Scan suspenso: perfil ou destino não compatível.');return;}
   if(status.txActive){this.emit('TX_ACTIVE');return;}
   if(!status.connected){if(this.state!=='RECONNECTING'){this.epoch++;this.tg=0;this.awaitAck=false;this.dwellUntil=0;this.lastRx=null;}this.emit('RECONNECTING');return;}
   if(this.state==='TX_ACTIVE'){this.holdUntil=now+this.options.holdMs;this.emit('HOLD_AFTER_RX');return;}
   // Any local RX (including an individual call) freezes group selection.
   if(status.rxBusy){if(this.lastRx?.tg===this.tg)this.emit('RX_ACTIVE');return;}
   if(this.state==='RX_ACTIVE'){this.holdUntil=now+this.options.holdMs;this.emit('HOLD_AFTER_RX');return;}
   if(this.state==='HOLD_AFTER_RX'&&now<this.holdUntil)return;
   if(this.pending)return;
   if(this.awaitAck){
    if(Number(status.receptionTarget)===this.tg&&['ready','awaiting-traffic','receiving'].includes(status.receptionState)){this.awaitAck=false;this.dwellUntil=now+this.options.dwellMs;this.emit('SCANNING');}
    else if(now>=this.ackDeadline)this.fail('O servidor não confirmou a inscrição desta TG. O scan foi parado.');
    return;
   }
   if(now<this.dwellUntil)return;
   const epoch=this.epoch,target=this.choose();this.pending=true;this.emit('SCANNING');
   try{const result=await this.tune(target);if(epoch!==this.epoch||!this.wanted)return;if(result?.deferred){this.dwellUntil=this.now()+300;return;}this.tg=target;this.lastRx=null;this.awaitAck=true;this.ackDeadline=this.now()+12000;this.emit('SCANNING');}
   catch(error){if(epoch===this.epoch)this.fail(error.message||'Falha ao solicitar inscrição ODTP.');}
   finally{this.pending=false;}
  }
 }
 class HoldPtt {
  constructor({start,stop}){this.start=start;this.stop=stop;this.pointer=null;this.pending=false;this.generation=0;}
  async down(pointer){if(this.pointer!==null||this.pending)return false;this.pointer=pointer;const generation=++this.generation;this.pending=true;
   try{await this.start();if(generation!==this.generation||this.pointer===null)await this.stop();return generation===this.generation;}
   catch(e){this.pointer=null;this.generation++;await this.stop();throw e;}finally{this.pending=false;}
  }
  async up(pointer){if(pointer!==undefined&&this.pointer!==null&&pointer!==this.pointer)return;this.pointer=null;this.generation++;await this.stop();}
 }
 return{Scan,HoldPtt};
});
