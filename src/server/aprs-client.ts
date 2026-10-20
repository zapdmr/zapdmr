import { EventEmitter } from 'node:events';
import net from 'node:net';
import fs from 'node:fs/promises';
import { randomInt } from 'node:crypto';

export interface AprsConfig { callsign:string; ssid?:number; host?:string; port?:number; messages?:boolean; map?:boolean; beacon?:boolean; smartBeacon?:boolean; intervalMinutes?:number; rangeKm?:number; latitude?:number; longitude?:number; symbol?:string }
export interface AprsMessage { id:string; from:string; to:string; text:string; direction:'in'|'out'; state:string; at:number }
const stationName=(value:string)=>value.trim().toUpperCase();
const validStation=(value:string)=>/^[A-Z0-9]{3,6}(?:-(?:[0-9]|1[0-5]))?$/.test(value)&&value.length<=9;
export function cleanAprsConfig(raw:AprsConfig):AprsConfig {
  const callsign=stationName(String(raw.callsign||''));
  if(!validStation(callsign))throw new Error('Indicativo APRS inválido (máximo 9 caracteres com SSID).');
  const host=String(raw.host||'rotate.aprs2.net').trim();
  if(!/^[a-zA-Z0-9.-]{1,180}$/.test(host))throw new Error('Servidor APRS inválido.');
  const lat=Number(raw.latitude),lon=Number(raw.longitude);
  return {callsign,ssid:Math.max(0,Math.min(15,Number(raw.ssid??5))),host,port:Math.max(1,Math.min(65535,Number(raw.port)||14580)),messages:raw.messages!==false,map:raw.map!==false,beacon:raw.beacon===true,smartBeacon:raw.smartBeacon===true,intervalMinutes:Math.max(1,Math.min(60,Number(raw.intervalMinutes)||5)),rangeKm:Math.max(1,Math.min(500,Number(raw.rangeKm)||250)),latitude:Number.isFinite(lat)&&Math.abs(lat)<=90?lat:undefined,longitude:Number.isFinite(lon)&&Math.abs(lon)<=180?lon:undefined,symbol:raw.symbol==='$'||raw.symbol==='phone'?'$':['[','-','>'].includes(raw.symbol||'')?raw.symbol:'['};
}
export class AprsClient extends EventEmitter {
  private socket?:net.Socket; private config?:AprsConfig; private passcode=''; private wanted=false; private verified=false;
  private state='disconnected'; private error=''; private buffer=''; private lastBeaconAt=0; private rxBytes=0; private txBytes=0;
  private history:AprsMessage[]=[]; private pending=new Map<string,{message:AprsMessage;packet:string;tries:number;at:number}>();
  private seen=new Map<string,number>(); private stations=new Map<string,unknown>(); private reconnect?:NodeJS.Timeout;
  private timer:NodeJS.Timeout; private writeQueue=Promise.resolve(); private retry=0; private sequence=randomInt(1,90000);
  private lastPosition?:{latitude:number;longitude:number;at:number}; private beaconPosition?:{latitude:number;longitude:number;at:number};
  constructor(private historyFile:string){super();this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();}
  async load(){try{const rows=JSON.parse(await fs.readFile(this.historyFile,'utf8'));if(Array.isArray(rows))this.history=rows.slice(-500).filter(row=>row&&typeof row.text==='string'&&validStation(row.from)&&validStation(row.to)).map(row=>({...row,state:row.state==='pending'?'failed':row.state}));}catch{}}
  snapshot(){return {state:this.state,verified:this.verified,station:this.config?.callsign||'',lastBeaconAt:this.lastBeaconAt||null,rxBytes:this.rxBytes,txBytes:this.txBytes,error:this.error,messages:this.history,stations:[...this.stations.values()]};}
  private publish(){this.emit('status',this.snapshot());}
  private save(){const data=JSON.stringify(this.history.slice(-500));this.writeQueue=this.writeQueue.catch(()=>{}).then(()=>fs.writeFile(this.historyFile,data,{mode:0o600}));}
  private message(row:AprsMessage){const existing=this.history.findIndex(item=>item.id===row.id&&item.from===row.from&&item.to===row.to&&item.direction===row.direction);if(existing>=0)this.history[existing]=row;else this.history.push(row);this.history=this.history.slice(-500);this.save();this.emit('message',row);}
  async connect(raw:AprsConfig,passcode:string){const config=cleanAprsConfig(raw);if(!/^-?\d{1,5}$/.test(passcode))throw new Error('Introduza o passcode APRS-IS ou -1 para somente receber.');this.disconnect();this.config=config;this.passcode=passcode;this.wanted=true;this.retry=0;this.open();return this.snapshot();}
  private open(){if(!this.wanted||!this.config)return;const c=this.config;this.state='connecting';this.error='';this.buffer='';this.verified=false;this.publish();const socket=net.createConnection({host:c.host!,port:c.port!,family:4});this.socket=socket;socket.setNoDelay(true);socket.setKeepAlive(true,30000);socket.setTimeout(180000);
    socket.once('connect',()=>{if(this.socket!==socket)return;const filter=Number.isFinite(c.latitude)&&Number.isFinite(c.longitude)&&c.map?` filter r/${c.latitude}/${c.longitude}/${c.rangeKm}`:'';this.write(`user ${c.callsign} pass ${this.passcode} vers ZapDMR 1.3.1${filter}`);});
    socket.on('data',data=>{if(this.socket!==socket)return;this.rxBytes+=data.length;this.buffer+=data.toString('latin1');if(this.buffer.length>65536){socket.destroy(new Error('Resposta APRS excessiva.'));return;}let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at).replace(/\r$/,'');this.buffer=this.buffer.slice(at+1);if(line.length<=510)this.line(line);}});
    socket.on('timeout',()=>socket.destroy(new Error('APRS sem resposta durante 180 segundos.')));socket.on('error',error=>{if(this.socket===socket)this.error=error.message;});
    socket.on('close',()=>{if(this.socket!==socket)return;this.socket=undefined;this.verified=false;this.state=this.wanted?'reconnecting':'disconnected';this.publish();if(this.wanted)this.reconnect=setTimeout(()=>this.open(),Math.min(60000,3000*++this.retry));});
  }
  private write(line:string){if(!this.socket||this.socket.destroyed||!this.socket.writable)throw new Error('Ligue primeiro ao APRS-IS.');if(/[\r\n]/.test(line)||Buffer.byteLength(line,'latin1')>510)throw new Error('Pacote APRS inválido.');this.socket.write(line+'\r\n','latin1');this.txBytes+=Buffer.byteLength(line,'latin1')+2;}
  private packet(body:string){if(!this.verified||!this.config)throw new Error('O servidor APRS ainda não confirmou um login verificado.');return `${this.config.callsign}>APZDMR,TCPIP*:${body}`;}
  sendMessage(to:string,text:string){to=stationName(to);if(!validStation(to))throw new Error('Indique o indicativo APRS com SSID correto.');if(!this.config?.messages)throw new Error('Ative Mensagens APRS nas definições.');if(!/^[\x20-\x7e]{1,67}$/.test(text)||/[{|~]/.test(text))throw new Error('APRS aceita até 67 caracteres ASCII, sem {, | ou ~.');if(this.pending.size>=5)throw new Error('Aguarde as mensagens pendentes (máximo 5).');const id=String(this.sequence++%99999);const packet=this.packet(`:${to.padEnd(9)}:${text}{${id}`);this.write(packet);const message:AprsMessage={id,from:this.config.callsign,to,text,direction:'out',state:'pending',at:Date.now()};this.pending.set(id,{message,packet,tries:1,at:Date.now()});this.message(message);return message;}
  position(latitude:number,longitude:number){if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw new Error('Posição GPS inválida.');if(!this.config)throw new Error('Configure a sessão APRS.');this.config.latitude=latitude;this.config.longitude=longitude;this.lastPosition={latitude,longitude,at:Date.now()};if(this.socket?.writable&&this.config.map)this.write(`#filter r/${latitude}/${longitude}/${this.config.rangeKm}`);}
  beacon(){const c=this.config;if(!c||!c.beacon)throw new Error('Ative Envio APRS-IS para publicar a sua posição.');if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude))throw new Error('Obtenha primeiro uma posição GPS válida.');const coordinate=(n:number,lat:boolean)=>{const hundredths=Math.round(Math.abs(n)*6000),deg=Math.floor(hundredths/6000);const minutes=((hundredths%6000)/100).toFixed(2).padStart(5,'0');return `${String(deg).padStart(lat?2:3,'0')}${minutes}${lat?(n>=0?'N':'S'):(n>=0?'E':'W')}`;};const symbol=c.symbol||'[';this.write(this.packet(`=${coordinate(c.latitude!,true)}/${coordinate(c.longitude!,false)}${symbol}ZapDMR`));this.lastBeaconAt=Date.now();this.beaconPosition={latitude:c.latitude!,longitude:c.longitude!,at:Date.now()};this.publish();}
  private line(line:string){if(line.startsWith('#')){if(new RegExp('^#\\s*logresp\\s+'+this.config?.callsign+'\\s+','i').test(line)){this.verified=/\bverified\b/i.test(line)&&!/\bunverified\b/i.test(line);this.state=this.verified?'connected':'receive-only';this.error=this.verified?'':'Login APRS não verificado: apenas receção.';this.retry=0;this.publish();}return;}
    const m=/^([A-Z0-9-]+)>[^:]+:(.*)$/.exec(line);if(!m||!validStation(m[1]))return;const from=m[1],body=m[2],own=this.config?.callsign;
    if(body.startsWith(':')&&body.length>=11&&body[10]===':'){
      const to=body.slice(1,10).trim(),text=body.slice(11);if(to!==own||!this.config?.messages)return;
      const ack=/^(ack|rej)([A-Za-z0-9]{1,5})(?:}|$)/.exec(text);if(ack){const pending=this.pending.get(ack[2]);if(pending&&pending.message.to===from){this.pending.delete(ack[2]);this.message({...pending.message,state:ack[1]==='ack'?'acknowledged':'rejected'});}return;}
      const split=text.lastIndexOf('{'),id=split>=0?text.slice(split+1).split('}')[0]:'';if(id&&!/^[A-Za-z0-9]{1,5}$/.test(id))return;
      if(id&&this.verified)this.write(this.packet(`:${from.padEnd(9)}:ack${id}`));const key=`${from}:${id||text}`;if(this.seen.has(key))return;this.seen.set(key,Date.now());this.message({id:id||String(Date.now()),from,to,text:split>=0?text.slice(0,split):text,direction:'in',state:'received',at:Date.now()});return;
    }
    const content='=/@!'.includes(body[0])?body.slice(body[0]==='/'||body[0]==='@'?8:1):'';
    const position=/^(\d{2})(\d{2}\.\d{2})([NS]).(\d{3})(\d{2}\.\d{2})([EW])/.exec(content);if(!position)return;
    const latitude=(Number(position[1])+Number(position[2])/60)*(position[3]==='S'?-1:1),longitude=(Number(position[4])+Number(position[5])/60)*(position[6]==='W'?-1:1);if(Math.abs(latitude)>90||Math.abs(longitude)>180)return;const station={callsign:from,latitude,longitude,at:Date.now()};this.stations.set(from,station);if(this.stations.size>500)this.stations.delete(this.stations.keys().next().value!);this.emit('station',station);
  }
  private tick(){const now=Date.now();for(const [key,at]of this.seen)if(now-at>3600000)this.seen.delete(key);for(const [id,item]of this.pending){if(now-item.at<30000)continue;if(item.tries>=3||!this.wanted){this.pending.delete(id);this.message({...item.message,state:'failed'});}else if(this.verified){try{this.write(item.packet);item.tries++;item.at=now;}catch{}}}
    const c=this.config;if(this.verified&&c?.beacon&&Number.isFinite(c.latitude)&&Number.isFinite(c.longitude)){let interval=(c.intervalMinutes||5)*60000;if(c.smartBeacon&&this.beaconPosition){const p=this.beaconPosition,lat=c.latitude!,lon=c.longitude!,km=111.2*Math.hypot(lat-p.latitude,(lon-p.longitude)*Math.cos(lat*Math.PI/180));if(km>=0.5)interval=Math.min(interval,60000);}if(now-this.lastBeaconAt>=interval)try{this.beacon();}catch(error){this.error=(error as Error).message;this.publish();}}
  }
  disconnect(){this.wanted=false;if(this.reconnect)clearTimeout(this.reconnect);this.reconnect=undefined;const socket=this.socket;this.socket=undefined;socket?.destroy();this.verified=false;this.passcode='';this.state='disconnected';for(const item of this.pending.values())this.message({...item.message,state:'failed'});this.pending.clear();this.publish();}
  close(){this.disconnect();clearInterval(this.timer);}
}
