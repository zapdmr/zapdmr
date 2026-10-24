import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

// Open DMR Terminal, service 0x21 on the REWIND01 transport. This is
// deliberately separate from Homebrew and from the SEA service 0x20.
export const ODTP = { keepalive:0, close:1, challenge:2, auth:3, report:0x100,
  subscribe:0x901, cancel:0x902, header:0x911, terminator:0x912, audio:0x920, superHeader:0x928, failure:0x929 };
export function terminalPacket(type:number, sequence:number, payload:Buffer=Buffer.alloc(0), flags=0):Buffer {
  const out=Buffer.alloc(18+payload.length);out.write('REWIND01');out.writeUInt16LE(type,8);
  out.writeUInt16LE(flags,10);out.writeUInt32LE(sequence>>>0,12);out.writeUInt16LE(payload.length,16);payload.copy(out,18);return out;
}
export function terminalHeader(destination:number,source:number,individual=false):Buffer {
  const data=Buffer.alloc(12);data[0]=individual?3:0;data[2]=4;data.writeUIntBE(destination,3,3);data.writeUIntBE(source,6,3);return data;
}
export class OpenTerminal extends EventEmitter {
  private sequence=0;private realtime=0;private timer?:NodeJS.Timeout;private lastSeen=0;private stopped=false;
  private authenticated=false;private authSent=false;private desired=0;private revision=0;private running=false;private privatePeer=0;private callSerial=0;
  private current?:{source:number;destination:number;individual:boolean};
  private pending?:{type:number;id:number;kind:number;resolve:(identified:boolean)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout};
  private reception={protocol:'odtp',supported:true,state:'disconnected',targetTalkgroupId:0,message:'ODTP desligado.'};
  constructor(private id:number,private password:string,private send:(packet:Buffer)=>Promise<void>){super();}
  snapshot(){return {...this.reception};}
  private update(state:string,message:string){if(this.reception.state===state&&this.reception.message===message&&this.reception.targetTalkgroupId===this.desired)return;this.reception={...this.reception,state,targetTalkgroupId:this.desired,message};this.emit('reception',this.snapshot());}
  async start(target:number){this.stopped=false;this.desired=target;this.lastSeen=Date.now();this.update('connecting','Conectando ao servidor ODTP…');await this.keepalive();
    this.timer=setInterval(()=>{if(Date.now()-this.lastSeen>15000){this.emit('failure',new Error('Servidor ODTP sem resposta; confira suporte, porta e autenticação.'));this.stop();return;}void this.keepalive().catch(e=>this.emit('failure',e));},5000);}
  private next(){return this.sequence++>>>0;}
  private async keepalive(){const payload=Buffer.alloc(5);payload.writeUInt32LE(this.id);payload[4]=0x21;await this.send(terminalPacket(0,this.next(),Buffer.concat([payload,Buffer.from('ZapDMR 1.4.1')])));}
  select(target:number,individual=false){if(this.desired===target&&this.privatePeer===(individual?target:0)&&!['error','disconnected'].includes(this.reception.state))return;this.desired=target;this.privatePeer=individual?target:0;this.revision++;this.current=undefined;this.update(this.authenticated?'subscribing':'connecting',this.authenticated?`${individual?'ID':'TG'} ${target} — solicitando inscrição…`:'Conectando ao servidor ODTP…');void this.reconcile();}
  private command(type:number,id=0,kind=7):Promise<boolean>{return new Promise((resolve,reject)=>{
    const payload=id?Buffer.alloc(8):Buffer.alloc(0);if(id){payload.writeUInt32LE(kind);payload.writeUInt32LE(id,4);}
    const timer=setTimeout(()=>{this.pending=undefined;reject(new Error('Servidor não confirmou a inscrição ODTP.'));},5000);
    this.pending={type,id,kind,resolve,reject,timer};this.send(terminalPacket(type,this.next(),payload)).catch(e=>{if(this.pending?.timer===timer){clearTimeout(timer);this.pending=undefined;reject(e);}});
  });}
  private async reconcile(){if(this.stopped||!this.authenticated||this.running)return;this.running=true;
    try{while(!this.stopped&&this.authenticated){const revision=this.revision,target=this.desired;this.current=undefined;
      await this.command(ODTP.cancel);if(revision!==this.revision)continue;
      if(!target){this.update('unsubscribed','Inscrição ODTP cancelada.');break;}
      const individual=this.privatePeer>0;
      const identified=await this.command(ODTP.subscribe,individual?this.id:target,individual?5:7);if(revision!==this.revision)continue;
      let privateWarning='';
      // Keep our individual address subscribed alongside the selected group.
      // This is a control request only: no PTT, voice frames or TG 4000.
      if(!individual){try{await this.command(ODTP.subscribe,this.id,5);}catch{privateWarning=' Chamadas individuais: inscrição não confirmada.';}if(this.stopped||!this.authenticated)return;if(revision!==this.revision)continue;}
      const label=individual?`ID ${target}`:`TG ${target}`;
      this.update(identified?'ready':'awaiting-traffic',(identified?`${label} — inscrição confirmada pelo servidor.`:`${label} — inscrição respondida; aguardando áudio para confirmar o destino.`)+privateWarning);break;}
    }catch(e){if(!this.stopped)this.update('error',`Inscrição ODTP falhou: ${(e as Error).message}`);}finally{this.running=false;}
  }
  receive(packet:Buffer){if(this.stopped||packet.length<18||packet.toString('ascii',0,8)!=='REWIND01'||packet.readUInt16LE(16)!==packet.length-18)return;
    this.lastSeen=Date.now();const type=packet.readUInt16LE(8),data=packet.subarray(18);
    if(type===ODTP.challenge){if(data.length!==4)return;this.authenticated=false;this.current=undefined;
      if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Servidor reiniciou a autenticação.'));this.pending=undefined;}
      this.authSent=true;this.update('authenticating','Validando Hotspot Security Password no ODTP…');void this.send(terminalPacket(ODTP.auth,this.next(),createHash('sha256').update(data).update(this.password).digest())).catch(e=>this.emit('failure',e));return;}
    if(type===ODTP.keepalive){if(this.authSent&&!this.authenticated){this.authenticated=true;this.emit('authenticated');void this.reconcile();}return;}
    if(type===ODTP.close||type===ODTP.failure){this.update('error','Servidor ODTP encerrou ou recusou a sessão. Confira senha e permissões.');this.emit('failure',new Error(this.reception.message));return;}
    if(type===ODTP.report){this.emit('report',data.toString('utf8').replace(/[^\x20-\x7e]/g,' ').slice(0,160));return;}
    if(this.pending?.type===type){const pending=this.pending;
      const identified=data.length>=8&&data.readUInt32LE(0)===pending.kind&&data.readUInt32LE(4)===pending.id;
      if(data.length&&pending.id&&!identified)return;
      clearTimeout(pending.timer);this.pending=undefined;pending.resolve(identified);return;}
    if(!this.authenticated)return;
    if(type===ODTP.header||type===ODTP.terminator){if(data.length<9)return;this.callSerial++;this.current=type===ODTP.terminator?undefined:{source:data.readUIntBE(6,3),destination:data.readUIntBE(3,3),individual:(data[0]&0x3f)===3};return;}
    if(type===ODTP.superHeader){if(data.length<12||![5,7].includes(data.readUInt32LE(0))||data.readUInt32LE(4)>0xffffff||data.readUInt32LE(8)>0xffffff)return;this.callSerial++;this.current={individual:data.readUInt32LE(0)===5,source:data.readUInt32LE(4),destination:data.readUInt32LE(8)};return;}
    if(type===ODTP.audio&&data.length===27&&this.current){const call=this.current;
      const matches=this.desired>0&&call.source>0&&call.source!==this.id&&(call.individual?call.destination===this.id&&(!this.privatePeer||call.source===this.privatePeer):!this.privatePeer&&call.destination===this.desired);
      if(!matches||(this.running&&this.pending?.kind!==5)||this.pending?.type===ODTP.cancel)return;
      this.update('receiving',call.individual?`Chamada individual de Radio ID ${call.source} — áudio recebido.`:`TG ${this.desired} — áudio recebido pela conexão ODTP.`);this.emit('voice',{...call,streamId:this.callSerial>>>0,words:[data.subarray(0,9),data.subarray(9,18),data.subarray(18,27)]});}
  }
  async transmit(type:number,payload:Buffer){if(!this.authenticated||this.stopped)throw new Error('ODTP não autenticado.');await this.send(terminalPacket(type,this.realtime++,payload,1));}
  async close(){try{if(!this.stopped)await this.send(terminalPacket(ODTP.close,this.next()));}finally{this.stop();}}
  stop(){this.stopped=true;this.authenticated=false;this.password='';this.current=undefined;clearInterval(this.timer);if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Sessão encerrada.'));this.pending=undefined;}this.update('disconnected','ODTP desligado.');}
}
