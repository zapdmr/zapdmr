import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export interface LastHeardActivity {
  id: number;
  lastActivityAt?: number;
  lastCallerCallsign?: string;
  lastCallerName?: string;
  sourceId?: string;
  location?: string;
  country?: string;
  active?: boolean;
}

interface MqttCall {
  id: number;
  callsign?: string;
  name?: string;
  sourceId?: string;
  location?: string;
  country?: string;
  event?: string;
  topic?: string;
}

const DEFAULT_URLS = [
  'wss://api.brandmeister.network/lh/socket.io/?EIO=4&transport=websocket',
  'wss://hose.brandmeister.network/socket.io/?EIO=4&transport=websocket'
];

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function field(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key !== undefined && record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function numericId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(?:TG\s*)?(\d{1,8})$/i);
  return match ? Number(match[1]) : undefined;
}

function mqttCall(value: unknown, inheritedTopic?: string): MqttCall | undefined {
  const decoded = parseJson(value);
  const record = asRecord(decoded);
  if (!record) {
    if (Array.isArray(decoded)) {
      for (const item of decoded) {
        const result = mqttCall(item, inheritedTopic);
        if (result) return result;
      }
    }
    return undefined;
  }

  const topicValue = field(record, 'topic', 'Topic') ?? inheritedTopic;
  const topic = typeof topicValue === 'string' ? topicValue : undefined;
  const explicitId = numericId(field(record, 'DestinationID', 'Talkgroup', 'TalkGroup', 'TG'));
  const topicId = topic?.match(/(?:^|\/)DMR\/Voice\/(\d{1,8})(?:\/|$)/i)?.[1];
  const id = explicitId && explicitId > 0 ? explicitId : topicId ? Number(topicId) : undefined;
  if (id && id > 0 && id <= 0xffffff) {
    const callValue = field(record, 'SourceCall', 'SourceCallsign', 'Callsign');
    const nameValue = field(record, 'SourceName', 'Name');
    const sourceIdValue = field(record, 'SourceID', 'SourceId');
    const cityValue = field(record, 'SourceCity', 'City');
    const stateValue = field(record, 'SourceState', 'State', 'Province');
    const countryValue = field(record, 'SourceCountry', 'Country');
    const locationValue = field(record, 'SourceLocation', 'Location');
    const eventValue = field(record, 'Event', 'event', 'Action');
    const startValue = field(record, 'Start');
    const stopValue = field(record, 'Stop');
    const inferredEvent = eventValue === undefined
      ? stopValue !== undefined && (stopValue === true || Number(stopValue) > 0 || String(stopValue).toLowerCase() === 'true')
        ? 'Session-Stop'
        : startValue !== undefined ? 'Session-Start' : undefined
      : undefined;
    return {
      id,
      callsign: typeof callValue === 'string' ? callValue.trim().slice(0, 16) : undefined,
      name: typeof nameValue === 'string' ? nameValue.trim().slice(0, 48) : undefined,
      sourceId: sourceIdValue === undefined ? undefined : String(sourceIdValue),
      location: typeof locationValue === 'string' ? locationValue.trim().slice(0, 100)
        : [cityValue, stateValue].filter((part) => typeof part === 'string' && part.trim())
          .map((part) => String(part).trim()).join(', ').slice(0, 100) || undefined,
      country: typeof countryValue === 'string' ? countryValue.trim().slice(0, 60) : undefined,
      event: typeof eventValue === 'string' ? eventValue : inferredEvent,
      topic
    };
  }

  for (const key of ['payload', 'data', 'message', 'call']) {
    const nested = field(record, key);
    if (nested !== undefined) {
      const result = mqttCall(nested, topic);
      if (result) return result;
    }
  }
  return undefined;
}

/** Public BrandMeister Last Heard Socket.IO stream (Engine.IO v4 over WebSocket). */
export class BrandMeisterLastHeardMonitor extends EventEmitter {
  private socket?: WebSocket;
  private handshakeTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private lastEnginePingAt = 0;
  private enginePingDeadlineMs = 45000;
  private subscribed = false;
  private retryTimer?: NodeJS.Timeout;
  private retryAttempt = 0;
  private closed = false;
  private state: 'connecting' | 'connected' | 'reconnecting' | 'unavailable' = 'connecting';
  private message = 'A ligar ao Last Heard público da BrandMeister…';
  private nextUrlIndex = 0;
  private activeSessions = new Map<number, Set<string>>();
  private readonly urls: string[];
  private readonly retryDelays = [3000, 5000, 10000, 15000, 30000, 60000];

  constructor(urlOverride?: string) {
    super();
    const configured = urlOverride?.split(',').map((url) => url.trim()).filter(Boolean) ?? [];
    this.urls = configured.length ? configured : DEFAULT_URLS;
  }

  status() {
    return { state: this.state, message: this.message, retryAttempt: this.retryAttempt };
  }

  start(): void {
    if (this.closed || this.socket || this.retryTimer) return;
    this.connectNext();
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.retryTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.clearActiveSessions();
    socket?.removeAllListeners();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  private connectNext(): void {
    if (this.closed) return;
    const url = this.urls[this.nextUrlIndex % this.urls.length];
    this.nextUrlIndex += 1;
    this.state = this.retryAttempt === 0 ? 'connecting' : 'reconnecting';
    let hostname = 'servidor público';
    try { hostname = new URL(url).hostname; } catch { /* Invalid overrides are handled by ws below. */ }
    this.message = `A ligar ao Last Heard (${hostname})…`;
    this.emit('status', this.status());
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, { headers: {
        Origin: 'https://brandmeister.network',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      } });
    } catch (error) {
      this.scheduleRetry((error as Error).message);
      return;
    }
    this.socket = socket;
    socket.on('open', () => {
      // Engine.IO sends packet 0 first; Socket.IO namespace connect (40) follows it.
      this.handshakeTimer = setTimeout(() => {
        if (this.socket === socket && this.state !== 'connected') socket.close();
      }, 10000);
      this.subscribed = false;
    });
    socket.on('message', (data) => this.handleMessage(data.toString()));
    socket.on('error', (error) => {
      if (this.socket !== socket) return;
      this.message = `Last Heard: ${error.message}`;
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.handshakeTimer = undefined;
      this.heartbeatTimer = undefined;
      this.socket = undefined;
      this.clearActiveSessions();
      this.scheduleRetry('Conexão pública de Last Heard encerrada.');
    });
  }

  private send(packet: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(packet);
  }

  private handleMessage(packet: string): void {
    if (packet.startsWith('0')) {
      // Engine.IO open packet: respond with Socket.IO namespace connect.
      try {
        const handshake = JSON.parse(packet.slice(1)) as { pingInterval?: unknown; pingTimeout?: unknown };
        const pingInterval = Number(handshake.pingInterval);
        const pingTimeout = Number(handshake.pingTimeout);
        if (Number.isFinite(pingInterval) && pingInterval > 0 && Number.isFinite(pingTimeout) && pingTimeout > 0)
          this.enginePingDeadlineMs = pingInterval + pingTimeout;
      } catch { /* Keep the conservative default if the open packet has no JSON body. */ }
      this.lastEnginePingAt = Date.now();
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (this.socket && Date.now() - this.lastEnginePingAt > this.enginePingDeadlineMs) this.socket.close();
      }, Math.min(10000, Math.max(1000, Math.floor(this.enginePingDeadlineMs / 4))));
      this.send('40');
      return;
    }
    if (packet.startsWith('2')) {
      // Engine.IO application-level ping. WebSocket control pings are handled by ws.
      this.lastEnginePingAt = Date.now();
      this.send(`3${packet.slice(1)}`);
      return;
    }
    if (packet.startsWith('40')) {
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
      this.retryAttempt = 0;
      this.state = 'connected';
      this.message = 'Last Heard global conectado.';
      if (!this.subscribed) {
        // The BrandMeister LH socket sends mqtt events only after joining its
        // public stream room; Socket.IO encoding is event packet 42 + JSON.
        this.send('42["join","everything"]');
        this.subscribed = true;
      }
      this.emit('status', this.status());
      return;
    }
    if (packet.startsWith('41')) {
      this.socket?.close();
      return;
    }
    if (packet.startsWith('1')) {
      this.socket?.close();
      return;
    }
    if (!packet.startsWith('42')) return;

    try {
      const eventPacket = JSON.parse(packet.slice(2)) as unknown;
      if (!Array.isArray(eventPacket) || eventPacket[0] !== 'mqtt') return;
      const call = mqttCall(eventPacket[1]);
      if (!call) return;
      const eventName = call.event?.toLowerCase();
      const isStart = eventName === 'session-start' || eventName === 'start';
      const isStop = eventName === 'session-stop' || eventName === 'stop';
      const isUpdate = eventName === 'session-update' || eventName === 'update';
      const hasVoiceTopic = Boolean(call.topic?.match(/(?:^|\/)DMR\/Voice\//i));
      if (!isStart && !isStop && !isUpdate && !hasVoiceTopic) return;

      let active: boolean | undefined;
      if (isStart || isUpdate) {
        const sessions = this.activeSessions.get(call.id) ?? new Set<string>();
        sessions.add(call.sourceId || call.callsign || 'default');
        this.activeSessions.set(call.id, sessions);
        active = true;
      } else if (isStop) {
        const sessions = this.activeSessions.get(call.id);
        if (sessions) {
          sessions.delete(call.sourceId || call.callsign || 'default');
          if (!sessions.size) this.activeSessions.delete(call.id);
        }
        active = Boolean(this.activeSessions.get(call.id)?.size);
      }
      this.emit('activity', {
        id: call.id,
        lastActivityAt: Date.now(),
        lastCallerCallsign: call.callsign,
        lastCallerName: call.name,
        sourceId: call.sourceId,
        location: call.location,
        country: call.country,
        active
      } satisfies LastHeardActivity);
      this.emit('participant', {
        talkgroupId: call.id,
        sourceId: call.sourceId,
        callsign: call.callsign,
        name: call.name,
        location: call.location,
        country: call.country,
        at: Date.now(),
        event: call.event
      });
    } catch {
      // Ignore malformed or unrelated MQTT event frames without interrupting reconnects.
    }
  }

  private scheduleRetry(reason: string): void {
    if (this.closed || this.retryTimer) return;
    this.retryAttempt += 1;
    const delay = this.retryDelays[Math.min(this.retryAttempt - 1, this.retryDelays.length - 1)];
    this.state = 'unavailable';
    this.message = `${reason} Nova tentativa em ${Math.round(delay / 1000)} s.`;
    this.emit('status', this.status());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connectNext();
    }, delay);
  }

  private clearActiveSessions(): void {
    for (const id of this.activeSessions.keys()) this.emit('activity', { id, active: false } satisfies LastHeardActivity);
    this.activeSessions.clear();
  }
}
