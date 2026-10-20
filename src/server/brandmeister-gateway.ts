import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import dgram, { type Socket } from 'node:dgram';
import { OpenTerminal, ODTP, terminalHeader } from './open-terminal';
import { DEFAULT_HOTSPOT_FREQUENCY_HZ, type AppSettings } from './types';
import { buildFullLcBurst, buildVoiceBurst, extractVoiceCodewords, type DmrCallType } from './dmr-voice-framer';

const DEFAULT_MASTER_PORT = 62031;
const LOGIN_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 60_000;
const DMRD_HEADER_LENGTH = 20;
const DMRD_SLOT_DATA_LENGTH = 33;
const DMRD_BER_OFFSET = DMRD_HEADER_LENGTH + DMRD_SLOT_DATA_LENGTH;
const DMRD_RSSI_OFFSET = DMRD_BER_OFFSET + 1;
const DMRD_BASE_PACKET_LENGTH = DMRD_RSSI_OFFSET + 1;
const DMRD_TRUNKING_UUID_OFFSET = DMRD_BASE_PACKET_LENGTH;
const DMRD_TRUNKING_UUID_LENGTH = 16;
const DMRD_TRUNKING_PACKET_LENGTH = DMRD_TRUNKING_UUID_OFFSET + DMRD_TRUNKING_UUID_LENGTH;

function isDmrDataPacket(packet: Buffer): boolean {
  return (packet.length === DMRD_BASE_PACKET_LENGTH || packet.length === DMRD_TRUNKING_PACKET_LENGTH) &&
    packet.toString('ascii', 0, 4) === 'DMRD';
}

type GatewayState = 'disconnected' | 'resolving' | 'waiting-login' | 'waiting-auth' |
  'waiting-config' | 'connected' | 'error';

interface ConnectResult { accepted: boolean; code: string; message: string }

/** HBP session, AMBE sidecar bridge, DMR framing and DMRD relay. */
export class BrandMeisterGateway extends EventEmitter {
  private socket?: Socket;
  private terminal?: OpenTerminal;
  private protocol: 'hbp' | 'odtp' = 'hbp';
  private rxTarget = 724;
  private state: GatewayState = 'disconnected';
  private stateMessage = 'Desligado.';
  private lastErrorCode?: string;
  private radioId?: number;
  private hotspotId?: number;
  private password?: string;
  private callsign?: string;
  private rxFrequencyHz?: string;
  private txFrequencyHz?: string;
  private locationName = '';
  private latitude = '0.000000';
  private longitude = '00.000000';
  private masterHost?: string;
  private masterPort = DEFAULT_MASTER_PORT;
  private connectTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private txArmed = false;
  private txActive = false;
  private audioReady = false;
  private txVoiceSequence = 0;
  private txCodewords: Buffer[] = [];
  private txStopping = false;
  private txSendQueue: Promise<ConnectResult> = Promise.resolve({ accepted: true, code: 'TX_IDLE', message: '' });
  private txLcSent = false;
  private txTalkgroupId?: number;
  private txCallType: DmrCallType = 'group';
  private usageRxBytes = 0;
  private usageTxBytes = 0;
  private usageSince = Date.now();
  private txSlot: 1 | 2 = 1;
  private disconnectingTalkgroup = false;
  private talkgroupBurstActive = false;
  private talkgroupActivity = new Map<number, {
    lastActivityAt: number;
    lastCallerCallsign?: string;
    lastCallerName?: string;
    location?: string;
    country?: string;
    active?: boolean;
  }>();
  private streamId?: number;
  private sequence = 0;
  private pendingConnect?: { resolve: (result: ConnectResult) => void };
  private lastMasterSeen = 0;

  status() {
    return {
      state: this.state,
      protocol: this.protocol,
      reception: this.terminal?.snapshot() || {protocol:this.protocol,supported:this.protocol==='odtp',state:this.state==='connected'?'unsupported':this.state,targetTalkgroupId:this.rxTarget,message:this.state==='connected'?'Homebrew/HBP não oferece inscrição de TG sem PTT. Use ODTP num master compatível.':this.stateMessage},
      errorCode: this.lastErrorCode,
      connected: this.state === 'connected',
      pttReady: this.state === 'connected' && this.audioReady,
      dmrdRelayReady: this.state === 'connected',
      voiceCodecAvailable: this.audioReady,
      pttArmed: this.txArmed,
      transmitting: this.txActive,
      talkgroupId: this.txTalkgroupId ?? null,
      callType: this.txCallType,
      usage: this.usageSnapshot(),
      disconnectingTalkgroup: this.disconnectingTalkgroup,
      talkgroupBurstActive: this.talkgroupBurstActive,
      streamId: this.streamId ?? null,
      radioId: this.radioId ?? null,
      hotspotId: this.hotspotId ? String(this.hotspotId) : null,
      message: this.stateMessage
    };
  }

  /** HBP payload bytes, including authentication and keepalives; excludes IP/UDP overhead. */
  usageSnapshot() {
    return { rxBytes: this.usageRxBytes, txBytes: this.usageTxBytes, since: this.usageSince };
  }

  restoreUsage(value: { rxBytes?: number; txBytes?: number; since?: number }): void {
    const safe = (v: number | undefined) => Number.isSafeInteger(v) && v! >= 0 ? v! : 0;
    this.usageRxBytes = safe(value.rxBytes);
    this.usageTxBytes = safe(value.txBytes);
    this.usageSince = value.since && Number.isFinite(value.since) && value.since > 0 ? value.since : Date.now();
  }

  resetUsage(): void {
    this.usageRxBytes = 0; this.usageTxBytes = 0; this.usageSince = Date.now();
    this.emit('usage', this.usageSnapshot());
    this.emit('status', this.status());
  }

  /** Private voice is addressed to our Radio ID, rather than to the selected peer ID. */
  isSelectedVoicePacket(packet: Buffer, targetId: number, callType: DmrCallType = 'group'): boolean {
    if (!isDmrDataPacket(packet)) return false;
    const individual = (packet[15] & 0x40) !== 0;
    const destination = packet.readUIntBE(8, 3);
    if (callType === 'private')
      return individual && destination === this.radioId && packet.readUIntBE(5, 3) === targetId;
    return !individual && destination === targetId;
  }

  talkgroupActivitySnapshot(): Record<string, {
    lastActivityAt: number;
    lastCallerCallsign?: string;
    lastCallerName?: string;
    location?: string;
    country?: string;
    active?: boolean;
  }> {
    return Object.fromEntries([...this.talkgroupActivity.entries()].map(([id, activity]) => [String(id), activity]));
  }

  private noteTalkgroupActivity(talkgroupId: number, metadata: {
    lastActivityAt?: number;
    lastCallerCallsign?: string;
    lastCallerName?: string;
    location?: string;
    country?: string;
    active?: boolean;
  } = {}): void {
    if (!Number.isInteger(talkgroupId) || talkgroupId < 1 || talkgroupId > 0xffffff) return;
    const lastActivityAt = metadata.lastActivityAt ?? Date.now();
    const previous = this.talkgroupActivity.get(talkgroupId);
    const activity = {
      lastActivityAt,
      lastCallerCallsign: metadata.lastCallerCallsign || previous?.lastCallerCallsign,
      lastCallerName: metadata.lastCallerName || previous?.lastCallerName,
      location: metadata.location || previous?.location,
      country: metadata.country || previous?.country,
      active: metadata.active ?? previous?.active
    };
    this.talkgroupActivity.set(talkgroupId, activity);
    if (this.talkgroupActivity.size > 4096) {
      const cutoff = lastActivityAt - 60 * 60 * 1000;
      for (const [id, seen] of this.talkgroupActivity) if (seen.lastActivityAt < cutoff) this.talkgroupActivity.delete(id);
      while (this.talkgroupActivity.size > 4096) this.talkgroupActivity.delete(this.talkgroupActivity.keys().next().value!);
    }
    this.emit('talkgroup-activity', { id: talkgroupId, ...activity });
  }

  noteGlobalTalkgroupActivity(activity: {
    id: number;
    lastActivityAt?: number;
    lastCallerCallsign?: string;
    lastCallerName?: string;
    location?: string;
    country?: string;
    active?: boolean;
  }): void {
    // When the public stream disconnects, clear its active-session indicator
    // without inventing a new packet timestamp (which would keep the LED green).
    if (activity.active === false && activity.lastActivityAt === undefined &&
        !activity.lastCallerCallsign && !activity.lastCallerName) {
      const previous = this.talkgroupActivity.get(activity.id);
      if (previous) {
        const cleared = { ...previous, active: false };
        this.talkgroupActivity.set(activity.id, cleared);
        this.emit('talkgroup-activity', { id: activity.id, ...cleared });
      }
      return;
    }
    this.noteTalkgroupActivity(activity.id, activity);
  }

  setAudioReady(ready: boolean): void {
    this.audioReady = ready;
    this.emit('status', this.status());
  }

  async pushVoiceCodeword(codeword: Buffer): Promise<ConnectResult> {
    if (codeword.length !== 9)
      return { accepted: false, code: 'INVALID_AMBE_CODEWORD', message: 'O sidecar deve entregar um codeword AMBE de 9 bytes.' };
    if (!this.txArmed || this.txStopping || this.state !== 'connected')
      return { accepted: false, code: 'PTT_NOT_ARMED', message: 'O PTT não está armado.' };
    this.txCodewords.push(Buffer.from(codeword));
    if (this.txCodewords.length < 3)
      return { accepted: true, code: 'AMBE_BUFFERED', message: 'Codeword AMBE aguardando completar uma rajada de 60 ms.' };

    const words = this.txCodewords.splice(0, 3);
    const operation = this.txSendQueue.then(async () => {
      if (!this.txArmed || this.state !== 'connected')
        return { accepted: false, code: 'PTT_NOT_ARMED', message: 'O PTT foi desarmado antes do envio da rajada.' };
      const sequence = this.txVoiceSequence;
      const slot = buildVoiceBurst(words, sequence === 0, 1, { destinationId: this.txTalkgroupId!, sourceId: this.radioId!, callType: this.txCallType, sequence });
      const flags = sequence === 0 ? 0x10 : sequence;
      const result = await this.sendDmrFrame(this.buildDmrFrame(slot, flags));
      if (result.accepted) this.txVoiceSequence = (sequence + 1) % 6;
      return result;
    });
    this.txSendQueue = operation.catch((error) => ({
      accepted: false,
      code: 'TX_FRAME_FAILED',
      message: (error as Error).message
    }));
    return operation.catch((error) => ({
      accepted: false,
      code: 'TX_FRAME_FAILED',
      message: (error as Error).message
    }));
  }

  receiveVoiceCodewords(packet: Buffer): Buffer[] {
    if (!isDmrDataPacket(packet)) return [];
    const flags = packet[15];
    // The slot bit (bit 7) is deliberately not a filter: simplex hotspots
    // still need to play valid voice frames reported on either DMR slot.
    if ((flags & 0x20) !== 0) return [];
    if ((flags & 0x10) === 0 && (flags & 0x0f) > 5) return [];
    return extractVoiceCodewords(packet.subarray(DMRD_HEADER_LENGTH, DMRD_BER_OFFSET));
  }

  selectReception(id:number,callType:DmrCallType='group') {
    this.rxTarget=id;
    this.terminal?.select(id,callType==='private');
    this.emit('status',this.status());
  }

  async connect(settings: AppSettings, password?: string): Promise<ConnectResult> {
    if (this.state !== 'disconnected' && this.state !== 'error') {
      return { accepted: false, code: 'ALREADY_CONNECTED', message: 'Já existe uma sessão HBP em andamento.' };
    }

    const callsign = settings.callsign.trim().toUpperCase();
    const dmrId = settings.dmrId.trim();
    const essid = settings.essid.trim();
    const rxFrequencyHz = settings.rxFrequencyHz?.trim() || DEFAULT_HOTSPOT_FREQUENCY_HZ;
    const txFrequencyHz = settings.txFrequencyHz?.trim() || DEFAULT_HOTSPOT_FREQUENCY_HZ;
    const masterHost = settings.masterHost.trim();
    if (!/^[A-Z0-9/ -]{1,8}$/.test(callsign))
      return this.fail('INVALID_CALLSIGN', 'Informe um indicativo válido com até 8 caracteres.');
    if (!/^\d{7}$/.test(dmrId))
      return this.fail('INVALID_DMR_ID', 'O Radio ID base deve ter 7 algarismos; o ESSID é informado à parte.');
    if (!/^\d{2}$/.test(essid))
      return this.fail('INVALID_ESSID', 'O ESSID deve ter dois algarismos, de 00 a 99.');
    if (!/^\d{9}$/.test(rxFrequencyHz) || rxFrequencyHz === '000000000' ||
        !/^\d{9}$/.test(txFrequencyHz) || txFrequencyHz === '000000000')
      return this.fail('INVALID_FREQUENCY', 'As frequências RX e TX devem conter nove algarismos em Hz e não podem ser zero.');
    if (!/^[a-zA-Z0-9.-]{1,180}$/.test(masterHost))
      return this.fail('INVALID_MASTER', 'Informe o endereço DNS ou IPv4 do master BrandMeister.');
    if (!password || password.length > 20 || /[^\x21-\x7e]/.test(password))
      return this.fail('INVALID_PASSWORD', 'Informe a Hotspot Security Password (até 20 caracteres imprimíveis).');

    const idText = `${dmrId}${essid}`;
    const id = Number(idText);
    if (!Number.isSafeInteger(id) || id > 0xffffffff)
      return this.fail('INVALID_HOTSPOT_ID', 'O ID composto do hotspot não é válido.');

    await this.disconnect(false);
    this.protocol=settings.radioProtocol==='odtp'?'odtp':'hbp';
    this.rxTarget=settings.selectedTalkgroupId;
    this.callsign = callsign;
    this.radioId = Number(dmrId);
    this.hotspotId = id;
    this.password = password;
    this.masterHost = masterHost;
    this.rxFrequencyHz = rxFrequencyHz;
    this.txFrequencyHz = txFrequencyHz;
    const network = settings.console?.network as Record<string, unknown> | undefined;
    const sendLocation = typeof network?.sendLocation === 'boolean' ? network.sendLocation : settings.sendLocationOnConnect === true;
    const hasLocation = sendLocation && Boolean(settings.latitude?.trim()) &&
      Boolean(settings.longitude?.trim()) && Number.isFinite(Number(settings.latitude)) &&
      Number.isFinite(Number(settings.longitude)) && Math.abs(Number(settings.latitude)) <= 90 && Math.abs(Number(settings.longitude)) <= 180;
    this.locationName = hasLocation ? settings.locationName?.trim() || '' : '';
    this.latitude = this.formatCoordinate(hasLocation ? settings.latitude : undefined, 8, 2);
    this.longitude = this.formatCoordinate(hasLocation ? settings.longitude : undefined, 9, 3);
    this.masterPort = Number.isInteger(settings.masterPort) && settings.masterPort >= 1 && settings.masterPort <= 65535
      ? settings.masterPort : DEFAULT_MASTER_PORT;
    this.txArmed = false;
    this.txActive = false;
    this.txStopping = false;
    this.txCodewords = [];
    this.txTalkgroupId = undefined;
    this.txCallType = 'group';
    this.setState('resolving', `A resolver ${masterHost}:${this.masterPort}…`);

    const socket = dgram.createSocket('udp4');
    this.socket = socket;
    socket.on('message', (packet) => {
      if(this.socket!==socket)return;
      if(this.terminal){this.usageRxBytes+=packet.length;this.emit('usage',this.usageSnapshot());this.terminal.receive(packet);}else this.handlePacket(packet);
    });
    if(this.protocol==='odtp'){
      const terminal=new OpenTerminal(this.radioId!,password!,packet=>this.send(packet));this.terminal=terminal;
      terminal.on('reception',()=>this.emit('status',this.status()));
      terminal.on('failure',(error:Error)=>this.failSession('ODTP_FAILED',error.message));
      terminal.on('authenticated',()=>{
        this.clearConnectTimer();this.setState('connected','ODTP autenticado; solicitando inscrição…');
        const pending=this.pendingConnect;this.pendingConnect=undefined;pending?.resolve({accepted:true,code:'CONNECTED',message:this.stateMessage});
      });
      terminal.on('voice',(call:{source:number;destination:number;individual:boolean;streamId:number;words:Buffer[]})=>{
        const frame=Buffer.alloc(55);frame.write('DMRD');frame.writeUIntBE(call.source,5,3);frame.writeUIntBE(call.destination,8,3);frame[15]=0x10|(call.individual?0x40:0);frame.writeUInt32BE(call.streamId,16);
        buildVoiceBurst(call.words,true,1,{destinationId:call.destination,sourceId:call.source,callType:call.individual?'private':'group',sequence:0}).copy(frame,20);
        if(!call.individual)this.noteTalkgroupActivity(call.destination);this.emit('frame',frame);
      });
    }
    socket.on('error', (error) => this.failSession('UDP_ERROR', `Erro no socket UDP: ${error.message}`));

    return new Promise<ConnectResult>((resolve) => {
      this.pendingConnect = {
        resolve
      };
      this.connectTimer = setTimeout(() => this.failSession(this.protocol==='odtp'?'ODTP_TIMEOUT':'HBP_TIMEOUT', `O master não concluiu a autenticação ${this.protocol.toUpperCase()} em 15 segundos. Confira protocolo, porta e senha.`), LOGIN_TIMEOUT_MS);
      // Send the first login packet only after Node confirms that the UDP
      // socket is associated with the master. A connect error must not fall
      // through to send(), where its callback could be misread as a port.
      socket.once('connect', () => {
        if (this.socket !== socket || this.state !== 'resolving') return;
        if(this.terminal){this.setState('waiting-login','Conectando ao servidor ODTP…');void this.terminal.start(this.rxTarget).catch(error=>this.failSession('ODTP_FAILED',error.message));return;}
        this.setState('waiting-login', 'Enviando pedido de registo HBP…');
        this.send(this.makeIdPacket('RPTL')).catch((sendError) =>
          this.failSession('UDP_SEND_FAILED', `Falha ao enviar RPTL: ${(sendError as Error).message}`));
      });
      try {
        socket.connect(this.masterPort, masterHost);
      } catch (error) {
        this.failSession('UDP_CONNECT_FAILED', `Falha ao associar socket UDP ao master: ${(error as Error).message}`);
      }
    });
  }

  async disconnect(announce = true): Promise<ConnectResult> {
    this.clearTimers();
    if (this.pendingConnect) {
      const pending = this.pendingConnect;
      this.pendingConnect = undefined;
      pending.resolve({ accepted: false, code: 'DISCONNECTED', message: 'Ligação cancelada.' });
    }
    const socket = this.socket;
    const terminal=this.terminal;
    if(terminal){await terminal.close().catch(()=>{});this.terminal=undefined;}
    if (!terminal && socket && this.hotspotId !== undefined) {
      const close = Buffer.alloc(9);
      close.write('RPTCL', 0, 'ascii');
      close.writeUInt32BE(this.hotspotId, 5);
      try { await this.send(close); } catch { /* socket may already be gone */ }
    }
    this.socket = undefined;
    this.txArmed = false;
    this.txActive = false;
    this.txStopping = false;
    this.txCodewords = [];
    this.txLcSent = false;
    this.txTalkgroupId = undefined;
    this.txCallType = 'group';
    this.txSlot = 1;
    this.disconnectingTalkgroup = false;
    this.streamId = undefined;
    this.password = undefined;
    this.radioId = undefined;
    this.hotspotId = undefined;
    this.callsign = undefined;
    this.rxFrequencyHz = undefined;
    this.txFrequencyHz = undefined;
    this.masterHost = undefined;
    this.lastErrorCode = undefined;
    if (socket) {
      try { socket.close(); } catch { /* already closed */ }
    }
    this.setState('disconnected', announce ? 'Desligado do master BrandMeister.' : 'Preparando nova sessão.');
    return { accepted: true, code: 'DISCONNECTED', message: this.stateMessage };
  }

  async setPtt(active: boolean, talkgroupId: number, slot: 1 | 2 = 1, callType: DmrCallType = 'group'): Promise<ConnectResult> {
    if(active&&this.terminal&&['connecting','subscribing','authenticating','error','unsubscribed'].includes(this.terminal.snapshot().state))
      return {accepted:false,code:'ODTP_SUBSCRIPTION_PENDING',message:'Aguarde a resposta da inscrição ODTP antes de transmitir.'};
    if (active) {
      if (this.state !== 'connected')
        return { accepted: false, code: 'NOT_CONNECTED', message: 'Ligue primeiro ao master BrandMeister.' };
      if (this.txArmed)
        return { accepted: false, code: 'PTT_ALREADY_ARMED', message: 'O PTT já está armado nesta sessão.' };
      if (!Number.isInteger(talkgroupId) || talkgroupId < 1 || talkgroupId > 0xffffff)
        return { accepted: false, code: 'INVALID_TALKGROUP', message: 'TalkGroup inválido.' };
      if (slot !== 1 && slot !== 2)
        return { accepted: false, code: 'INVALID_SLOT', message: 'O slot deve ser TS 1 ou TS 2.' };
      if (callType !== 'group' && callType !== 'private')
        return { accepted: false, code: 'INVALID_CALL_TYPE', message: 'Escolha uma chamada de grupo ou individual.' };
      if (!this.audioReady)
        return { accepted: false, code: 'AUDIO_UNAVAILABLE', message: 'O vocoder/servidor de áudio não está pronto.' };
      this.txArmed = true;
      this.txActive = false;
      this.txLcSent = false;
      this.txCodewords = [];
      this.txStopping = false;
      this.txSendQueue = Promise.resolve({ accepted: true, code: 'TX_IDLE', message: '' });
      this.txVoiceSequence = 0;
      this.txTalkgroupId = talkgroupId;
      this.txCallType = callType;
      // The HBP RPTC config advertises slots='4' for simplex. Always emit
      // simplex DMRD with bit 7 clear (TS1), even if the selected catalogue
      // entry is labelled TS2.
      this.txSlot = this.isSimplex() ? 1 : slot;
      this.streamId = randomBytes(4).readUInt32BE(0) || 1;
      this.sequence = 0;
      this.setState('connected', `PTT preparado para ${callType === 'private' ? 'ID' : 'TG'} ${talkgroupId}; aguardando áudio.`);
      const header = buildFullLcBurst(talkgroupId, this.radioId!, 1, 'header', this.txCallType);
      const headerResult = await this.sendDmrFrame(this.buildDmrFrame(header, 0x21));
      if (!headerResult.accepted) {
        this.txArmed = false;
        this.txStopping = false;
        this.txCodewords = [];
        this.txTalkgroupId = undefined;
        this.txCallType = 'group';
        this.streamId = undefined;
        return headerResult;
      }
      this.txLcSent = true;
      return { accepted: true, code: 'PTT_ARMED', message: this.stateMessage };
    }

    const wasArmed = this.txArmed;
    if (this.talkgroupBurstActive)
      return { accepted: false, code: 'TRANSMISSION_BUSY', message: 'Aguarde a rajada curta de áudio terminar.' };
    let result: ConnectResult = { accepted: true, code: wasArmed ? 'PTT_STOPPED' : 'PTT_IDLE', message: wasArmed ? 'PTT desarmado.' : 'PTT já estava em espera.' };
    if (wasArmed) {
      this.txStopping = true;
      await this.txSendQueue;
    }
    if (wasArmed && this.txLcSent && this.state === 'connected' && this.txTalkgroupId !== undefined && this.radioId !== undefined) {
      // A 20 ms tail cannot form a DMR burst; discard it and close the LC stream cleanly.
      this.txCodewords = [];
      const terminator = buildFullLcBurst(this.txTalkgroupId, this.radioId, 1, 'terminator', this.txCallType);
      result = await this.sendDmrFrame(this.buildDmrFrame(terminator, 0x22));
    }
    this.txArmed = false;
    this.txActive = false;
    this.txStopping = false;
    this.txCodewords = [];
    this.txTalkgroupId = undefined;
    this.txCallType = 'group';
    this.streamId = undefined;
    this.txLcSent = false;
    this.txSlot = 1;
    if (this.state === 'connected') this.setState('connected', 'Ligado ao master BrandMeister; PTT em espera.');
    return result;
  }

  /** Send a user-requested codec-generated silence burst to disconnect TG 4000. */
  async sendDisconnectTalkgroup(slot: 1 | 2, silenceCodewords: Buffer[]): Promise<ConnectResult> {
    return this.sendTalkgroupBurst(4000, slot, silenceCodewords);
  }

  async sendTalkgroupBurst(talkgroupId: number, slot: 1 | 2, silenceCodewords: Buffer[]): Promise<ConnectResult> {
    if(this.protocol==='odtp')return {accepted:false,code:'ODTP_NO_BURST',message:'ODTP usa inscrição/cancelamento, sem rajadas de ativação.'};
    if (this.state !== 'connected')
      return { accepted: false, code: 'NOT_CONNECTED', message: 'Ligue primeiro ao master BrandMeister.' };
    if (this.txArmed || this.talkgroupBurstActive)
      return { accepted: false, code: 'TRANSMISSION_BUSY', message: 'Termine a transmissão atual antes da rajada curta de áudio.' };
    if (!Number.isInteger(talkgroupId) || talkgroupId < 1 || talkgroupId > 0xffffff)
      return { accepted: false, code: 'INVALID_TALKGROUP', message: 'TalkGroup inválida para desconexão.' };
    if (slot !== 1 && slot !== 2)
      return { accepted: false, code: 'INVALID_SLOT', message: 'O slot deve ser TS 1 ou TS 2.' };
    if (this.radioId === undefined)
      return { accepted: false, code: 'NOT_CONNECTED', message: 'O Radio ID não está disponível nesta sessão.' };
    if (silenceCodewords.length !== 18 || silenceCodewords.some((word) => word.length !== 9))
      return { accepted: false, code: 'INVALID_SILENCE_AUDIO', message: 'O vocoder deve gerar 18 codewords AMBE de silêncio.' };

    this.talkgroupBurstActive = true;
    this.disconnectingTalkgroup = talkgroupId === 4000;
    this.txArmed = true;
    this.txActive = false;
    this.txLcSent = false;
    this.txStopping = false;
    this.txCodewords = [];
    this.txSendQueue = Promise.resolve({ accepted: true, code: 'TX_IDLE', message: '' });
    this.txTalkgroupId = talkgroupId;
    this.txCallType = 'group';
    this.txSlot = this.isSimplex() ? 1 : slot;
    this.streamId = randomBytes(4).readUInt32BE(0) || 1;
    this.sequence = 0;
    this.txVoiceSequence = 0;
    this.setState('connected', `A vincular TG ${talkgroupId} no TS ${this.txSlot}…`);

    const resultCode = talkgroupId === 4000 ? 'TG_DISCONNECT_SENT' : 'TG_LINK_SENT';
    const label = `comando TG ${talkgroupId}`;
    let result: ConnectResult = { accepted: true, code: resultCode, message: `${label} enviada.` };
    let terminatorSent = false;
    try {
      const header = buildFullLcBurst(talkgroupId, this.radioId, 1, 'header');
      result = await this.sendDmrFrame(this.buildDmrFrame(header, 0x21));
      if (!result.accepted) return result;
      this.txLcSent = true;
      await new Promise((resolve) => setTimeout(resolve, 60));
      for (let index = 0; index < silenceCodewords.length; index += 3) {
        const sequence = this.txVoiceSequence;
        const slotData = buildVoiceBurst(silenceCodewords.slice(index, index + 3), sequence === 0, 1, { destinationId: talkgroupId, sourceId: this.radioId, callType: 'group', sequence });
        result = await this.sendDmrFrame(this.buildDmrFrame(slotData, sequence === 0 ? 0x10 : sequence));
        if (!result.accepted) return result;
        this.txVoiceSequence = (sequence + 1) % 6;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      const terminator = buildFullLcBurst(talkgroupId, this.radioId, 1, 'terminator');
      result = await this.sendDmrFrame(this.buildDmrFrame(terminator, 0x22));
      terminatorSent = result.accepted;
      return result.accepted
        ? { accepted: true, code: resultCode, message: `Comando TG ${talkgroupId} enviado no slot atual.` }
        : result;
    } catch (error) {
      result = { accepted: false, code: 'TG_DISCONNECT_FAILED',
        message: `Falha ao enviar ${label}: ${(error as Error).message}` };
      return result;
    } finally {
      if (this.txLcSent && !terminatorSent && this.state === 'connected' && this.radioId !== undefined) {
        const terminator = buildFullLcBurst(talkgroupId, this.radioId, 1, 'terminator');
        await this.sendDmrFrame(this.buildDmrFrame(terminator, 0x22)).catch(() => undefined);
      }
      this.txArmed = false;
      this.txActive = false;
      this.txStopping = false;
      this.txCodewords = [];
      this.txTalkgroupId = undefined;
      this.txCallType = 'group';
      this.txSlot = 1;
      this.streamId = undefined;
      this.txLcSent = false;
      this.talkgroupBurstActive = false;
      this.disconnectingTalkgroup = false;
      if (this.state === 'connected') this.setState('connected', 'Ligado ao master BrandMeister; PTT em espera.');
    }
  }

  /**
   * Build the HBP DMRD envelope around one already-framed 33-byte DMR slot.
   * The codec/DMR framer supplies flags and slot data; this method stamps the
   * active Radio ID, hotspot ID (including ESSID), TG, stream and quality bytes.
   * Callsign is sent separately in the RPTC login configuration.
   */
  buildDmrFrame(slotData: Buffer, flags: number, trunkingUuid?: Buffer): Buffer {
    if (this.state !== 'connected' || this.radioId === undefined || this.hotspotId === undefined ||
        !this.txArmed || this.txTalkgroupId === undefined || this.streamId === undefined)
      throw new Error('Ligue ao master e arme o PTT antes de construir um quadro DMRD.');
    if (slotData.length !== DMRD_SLOT_DATA_LENGTH)
      throw new Error(`Os dados do slot DMR devem ter ${DMRD_SLOT_DATA_LENGTH} bytes.`);
    if (!Number.isInteger(flags) || flags < 0 || flags > 0xff)
      throw new Error('Os flags DMRD devem ser um byte entre 0 e 255.');
    if (trunkingUuid !== undefined && trunkingUuid.length !== DMRD_TRUNKING_UUID_LENGTH)
      throw new Error(`A extensão trunking deve conter ${DMRD_TRUNKING_UUID_LENGTH} bytes de UUID.`);

    const packet = Buffer.alloc(trunkingUuid ? DMRD_TRUNKING_PACKET_LENGTH : DMRD_BASE_PACKET_LENGTH);
    packet.write('DMRD', 0, 'ascii');
    packet[4] = this.sequence;
    packet.writeUIntBE(this.radioId, 5, 3);
    packet.writeUIntBE(this.txTalkgroupId, 8, 3);
    packet.writeUInt32BE(this.hotspotId, 11);
    packet[15] = (flags & 0x3f) | (this.txCallType === 'private' ? 0x40 : 0) | (this.txSlot === 2 ? 0x80 : 0);
    packet.writeUInt32BE(this.streamId, 16);
    slotData.copy(packet, DMRD_HEADER_LENGTH);
    // A software hotspot has no RF BER/RSSI measurement to report on TX.
    packet[DMRD_BER_OFFSET] = 0;
    packet[DMRD_RSSI_OFFSET] = 0;
    trunkingUuid?.copy(packet, DMRD_TRUNKING_UUID_OFFSET);
    return packet;
  }

  /** Relay a complete codec/framer-produced 55-byte DMRD or 71-byte trunking datagram. */
  async sendDmrFrame(encodedPacket: Buffer): Promise<ConnectResult> {
    if(this.protocol==='odtp'&&!this.terminal)return {accepted:false,code:'NOT_CONNECTED',message:'Sessão ODTP encerrada.'};
    if (this.state !== 'connected' || !this.socket || this.radioId === undefined || this.hotspotId === undefined)
      return { accepted: false, code: 'NOT_CONNECTED', message: 'Não há sessão HBP ligada.' };
    if (!this.txArmed || this.txTalkgroupId === undefined)
      return { accepted: false, code: 'PTT_NOT_ARMED', message: 'Arme o PTT antes de enviar quadros DMRD.' };
    if (!isDmrDataPacket(encodedPacket))
      return { accepted: false, code: 'INVALID_DMRD_FRAME', message: 'O quadro deve ser DMRD básico de 55 bytes ou trunking de 71 bytes.' };
    if (encodedPacket.readUIntBE(5, 3) !== this.radioId)
      return { accepted: false, code: 'WRONG_SOURCE_ID', message: 'O Radio ID de origem do quadro não corresponde ao perfil ligado.' };
    if (encodedPacket.readUInt32BE(11) !== this.hotspotId)
      return { accepted: false, code: 'WRONG_REPEATER_ID', message: 'O ID de repetidor do quadro não corresponde ao hotspot ligado.' };
    if (encodedPacket.readUIntBE(8, 3) !== this.txTalkgroupId)
      return { accepted: false, code: 'WRONG_TALKGROUP', message: 'O destino do quadro não corresponde à TG do PTT.' };
    if (encodedPacket.readUInt32BE(16) !== this.streamId)
      return { accepted: false, code: 'WRONG_STREAM_ID', message: 'O ID de stream do quadro não corresponde ao PTT atual.' };
    if (((encodedPacket[15] & 0x80) !== 0) !== (this.txSlot === 2))
      return { accepted: false, code: 'WRONG_SLOT', message: 'O slot do quadro não corresponde ao slot selecionado.' };
    if (((encodedPacket[15] & 0x40) !== 0) !== (this.txCallType === 'private'))
      return { accepted: false, code: 'WRONG_CALL_TYPE', message: 'O tipo de chamada do quadro não corresponde ao PTT.' };
    if (encodedPacket[4] !== this.sequence)
      return { accepted: false, code: 'OUT_OF_ORDER_FRAME', message: `Sequência esperada: ${this.sequence}.` };

    try {
      if(this.terminal){
        const kind=encodedPacket[15]&0x3f;
        if(kind===0x21||kind===0x22)await this.terminal.transmit(kind===0x21?ODTP.header:ODTP.terminator,terminalHeader(this.txTalkgroupId!,this.radioId!,this.txCallType==='private'));
        else await this.terminal.transmit(ODTP.audio,Buffer.concat(extractVoiceCodewords(encodedPacket.subarray(20,53))));
      }else await this.send(encodedPacket);
      this.sequence = (encodedPacket[4] + 1) & 0xff;
      this.txActive = true;
      if (this.txCallType === 'group') this.noteTalkgroupActivity(encodedPacket.readUIntBE(8, 3));
      this.setState('connected', `Transmitindo quadros DMRD para ${this.txCallType === 'private' ? 'ID' : 'TG'} ${this.txTalkgroupId}.`);
      return { accepted: true, code: 'FRAME_SENT', message: 'Quadro DMRD encaminhado ao master.' };
    } catch (error) {
      return { accepted: false, code: 'UDP_SEND_FAILED', message: `Falha ao enviar quadro: ${(error as Error).message}` };
    }
  }

  private handlePacket(packet: Buffer) {
    this.usageRxBytes += packet.length;
    this.emit('usage', this.usageSnapshot());
    if (this.state === 'connected') this.lastMasterSeen = Date.now();
    if (packet.length >= 6 && packet.toString('ascii', 0, 6) === 'MSTNAK') {
      // MSTNAK is used for several distinct rejection points in the HBP
      // handshake. Preserve the current phase so the UI does not blame the
      // password when the master actually rejected the ID or RPTC config.
      if (this.state === 'waiting-login') {
        this.failSession('LOGIN_REJECTED', 'O master rejeitou o Hotspot ID no RPTL; confira o Radio ID, o ESSID e se esse ID está ativo no BrandMeister.');
      } else if (this.state === 'waiting-auth') {
        this.failSession('AUTH_REJECTED', 'O master rejeitou a autenticação RPTK; confira a Hotspot Security Password definida para esse Radio ID no SelfCare.');
      } else if (this.state === 'waiting-config') {
        this.failSession('CONFIG_REJECTED', 'O master rejeitou a configuração RPTC. Confira os dados do perfil, as frequências RX/TX e os parâmetros do hotspot; o MSTNAK não informa o motivo específico.');
      } else {
        this.failSession('MASTER_REJECTED', 'O master rejeitou a sessão HBP.');
      }
      return;
    }
    if (packet.length >= 6 && packet.toString('ascii', 0, 6) === 'RPTACK') {
      if (this.state === 'waiting-login') {
        if (packet.length < 10 || !this.password || this.hotspotId === undefined) {
          this.failSession('INVALID_RPTACK', 'Resposta RPTACK sem o desafio de autenticação esperado.');
          return;
        }
        const id = Buffer.alloc(4); id.writeUInt32BE(this.hotspotId);
        const digest = createHash('sha256').update(Buffer.concat([packet.subarray(6, 10), Buffer.from(this.password, 'utf8')])).digest();
        this.setState('waiting-auth', 'Desafio recebido; enviando autorização…');
        this.send(Buffer.concat([Buffer.from('RPTK'), id, digest])).catch((error) =>
          this.failSession('UDP_SEND_FAILED', `Falha ao enviar autorização HBP: ${(error as Error).message}`));
      } else if (this.state === 'waiting-auth') {
        this.setState('waiting-config', 'Credenciais aceitas; enviando configuração…');
        this.send(this.makeConfigPacket()).catch((error) =>
          this.failSession('UDP_SEND_FAILED', `Falha ao enviar configuração HBP: ${(error as Error).message}`));
      } else if (this.state === 'waiting-config') {
        this.finishConnect();
      }
      return;
    }
    if (packet.length >= 7 && packet.toString('ascii', 0, 7) === 'MSTPONG') {
      this.lastMasterSeen = Date.now();
      this.setState(this.state, this.txArmed
        ? `PTT preparado para a TG ${this.txTalkgroupId}; aguardando quadros DMRD.`
        : 'Ligado ao master BrandMeister; PTT em espera.');
      return;
    }
    if (packet.length >= 5 && packet.toString('ascii', 0, 5) === 'MSTCL') {
      this.failSession('MASTER_CLOSED', 'O master encerrou a sessão HBP.');
      return;
    }
    if (isDmrDataPacket(packet)) {
      if ((packet[15] & 0x40) === 0) this.noteTalkgroupActivity(packet.readUIntBE(8, 3));
      this.emit('frame', packet);
    }
  }

  private finishConnect() {
    this.clearConnectTimer();
    this.lastMasterSeen = Date.now();
    this.setState('connected', 'Ligado ao master BrandMeister; PTT em espera.');
    this.pingTimer = setInterval(() => {
      if (this.state !== 'connected') return;
      if (Date.now() - this.lastMasterSeen > PING_INTERVAL_MS * 3) {
        this.failSession('MASTER_TIMEOUT', 'O master deixou de responder aos keepalive HBP.');
        return;
      }
      this.send(this.makeIdPacket('RPTPING')).catch((error) =>
        this.failSession('UDP_SEND_FAILED', `Falha ao enviar keepalive HBP: ${(error as Error).message}`));
    }, PING_INTERVAL_MS);
    const pending = this.pendingConnect;
    this.pendingConnect = undefined;
    pending?.resolve({ accepted: true, code: 'CONNECTED', message: this.stateMessage });
  }

  private makeIdPacket(tag: 'RPTL' | 'RPTPING'): Buffer {
    if (this.hotspotId === undefined) throw new Error('Hotspot ID ausente.');
    const idOffset = tag.length;
    const packet = Buffer.alloc(idOffset + 4);
    packet.write(tag, 0, 'ascii');
    packet.writeUInt32BE(this.hotspotId, idOffset);
    return packet;
  }

  private isSimplex(): boolean {
    return Boolean(this.rxFrequencyHz && this.txFrequencyHz && this.rxFrequencyHz === this.txFrequencyHz);
  }

  private formatCoordinate(value: string | undefined, width: number, degreeDigits: number): string {
    const number = Number(value);
    if (!value?.trim() || !Number.isFinite(number)) return degreeDigits === 2 ? '0.000000' : '00.000000';
    const sign = number < 0 ? '-' : '';
    const degrees = Math.abs(number).toFixed(4);
    const [whole, fraction] = degrees.split('.');
    return `${sign}${whole.padStart(degreeDigits, '0')}.${fraction}`.padStart(width, '0').slice(0, width);
  }

  private makeConfigPacket(): Buffer {
    if (this.hotspotId === undefined || !this.callsign || !this.rxFrequencyHz || !this.txFrequencyHz)
      throw new Error('Perfil ou frequências RX/TX incompletos.');
    const id = Buffer.alloc(4); id.writeUInt32BE(this.hotspotId);
    const fields = [
      this.fixed(this.callsign, 8), this.fixed(this.rxFrequencyHz, 9), this.fixed(this.txFrequencyHz, 9), '01', '01',
      this.latitude, this.longitude, '001', this.fixed(this.locationName, 20), this.fixed('ZapDMR virtual hotspot', 19),
      this.rxFrequencyHz === this.txFrequencyHz ? '4' : '3', // Simplex / duplex slot mode.
      this.fixed('', 124), this.fixed('20261016_ZapDMR', 40), this.fixed('MMDVM_ZapDMR', 40)
    ];
    const payload = Buffer.from(fields.join(''), 'ascii');
    const packet = Buffer.concat([Buffer.from('RPTC'), id, payload]);
    if (packet.length !== 302) throw new Error(`Tamanho RPTC inválido (${packet.length}).`);
    this.logConfigPacket(packet);
    return packet;
  }

  private logConfigPacket(packet: Buffer): void {
    const fields = [
      { name: 'tag', start: 0, end: 4 },
      { name: 'repeater ID', start: 4, end: 8 },
      { name: 'callsign', start: 8, end: 16 },
      { name: 'RX frequency', start: 16, end: 25 },
      { name: 'TX frequency', start: 25, end: 34 },
      { name: 'TX power', start: 34, end: 36 },
      { name: 'color code', start: 36, end: 38 },
      { name: 'latitude', start: 38, end: 46 },
      { name: 'longitude', start: 46, end: 55 },
      { name: 'height/reserved', start: 55, end: 58 },
      { name: 'site name', start: 58, end: 78 },
      { name: 'description', start: 78, end: 97 },
      { name: 'slots', start: 97, end: 98 },
      { name: 'URL', start: 98, end: 222 },
      { name: 'software ID', start: 222, end: 262 },
      { name: 'package ID', start: 262, end: 302 }
    ];

    console.info(`[HBP] RPTC outgoing packet: ${packet.length} bytes`);
    for (const field of fields) {
      const bytes = packet.subarray(field.start, field.end);
      const ascii = bytes.toString('ascii').replace(/[^\x20-\x7e]/g, '.');
      const decoded = field.name === 'repeater ID' && bytes.length === 4
        ? ` (${bytes.readUInt32BE(0)})`
        : '';
      console.info(`[HBP] RPTC bytes ${field.start}-${field.end - 1} ${field.name}: ASCII="${ascii}" HEX=${bytes.toString('hex')}${decoded}`);
    }
  }

  private fixed(value: string, length: number): string {
    return value.replace(/[^\x20-\x7e]/g, '').slice(0, length).padEnd(length, ' ');
  }

  private send(packet: Buffer): Promise<void> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('Socket UDP fechado.'));
    return new Promise((resolve, reject) => socket.send(packet, (error) => {
      if (error) { reject(error); return; }
      this.usageTxBytes += packet.length;
      this.emit('usage', this.usageSnapshot());
      resolve();
    }));
  }

  private setState(state: GatewayState, message: string) {
    this.state = state;
    this.stateMessage = message;
    if (state !== 'error') this.lastErrorCode = undefined;
    this.emit('status', this.status());
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private clearTimers() {
    this.clearConnectTimer();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private fail(code: string, message: string): ConnectResult {
    return { accepted: false, code, message };
  }

  private failSession(code: string, message: string) {
    if (this.state === 'error' || this.state === 'disconnected') return;
    this.terminal?.stop();this.terminal=undefined;
    const pending = this.pendingConnect;
    this.pendingConnect = undefined;
    this.clearTimers();
    const socket = this.socket;
    this.socket = undefined;
    this.txArmed = false;
    this.txActive = false;
    this.txStopping = false;
    this.txCodewords = [];
    this.txTalkgroupId = undefined;
    this.txCallType = 'group';
    this.streamId = undefined;
    this.password = undefined;
    this.radioId = undefined;
    this.hotspotId = undefined;
    this.callsign = undefined;
    this.rxFrequencyHz = undefined;
    this.txFrequencyHz = undefined;
    this.masterHost = undefined;
    this.lastErrorCode = code;
    if (socket) { try { socket.close(); } catch { /* already closed */ } }
    this.setState('error', message);
    pending?.resolve({ accepted: false, code, message });
  }
}
