import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { BrandMeisterGateway } from './brandmeister-gateway';
import { BrandMeisterLastHeardMonitor } from './brandmeister-lastheard';
import { AudioSidecarClient, AudioSidecarMessage, type AudioSidecarError } from './audio-sidecar-client';
import { loadWindowsSecret, saveWindowsSecret } from './secret-store';
import { DEFAULT_HOTSPOT_FREQUENCY_HZ, DEFAULT_SETTINGS, type AppSettings, type ServerType, type Theme, type Talkgroup } from './types';
import { startUdpTelemetry, type UdpTelemetry } from './udp-telemetry';
import { AprsClient } from './aprs-client';
import { SppSerial } from './spp-serial';

interface StartOptions {
  userDataDir?: string; port?: number; udpPort?: number; staticDir?: string; talkgroupsFile?: string;
  audioSidecarExe?: string; audioAssetsDir?: string; audioPipeName?: string; lastHeardUrl?: string;
}
const CUSTOM_TALKGROUP_CATEGORIES = new Set([
  'Nacionais', 'Mundiais', 'Mundiais/Países', 'Nacionais e mundiais', 'Regiões', 'Estados', 'Redes externas', 'Especiais'
]);
const DISCONNECT_SILENCE_CODEWORDS = 18;
const PARTICIPANT_RETENTION_MS = 30 * 60 * 1000;
const MAX_PARTICIPANTS = 2000;
interface DmrIdRecord { id: string; callsign: string; name?: string; city?: string; state?: string; country?: string }
interface RoundParticipant {
  key: string; talkgroupId: number; sourceId?: string; callsign: string; name: string;
  location: string; country: string; at: number; event?: string;
  city?: string; state?: string;
}
interface SavedProfile { id: string; name: string; settings: AppSettings }

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseDmrIdCsv(text: string): Record<string, DmrIdRecord> {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('O CSV deve conter cabeçalho e pelo menos um registo.');
  const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = rows[0].map(normalizeHeader);
  const findIndex = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  let idIndex = findIndex('radioid', 'dmrid', 'id', 'radioidnumber');
  let callsignIndex = findIndex('callsign', 'call', 'indicativo');
  let firstNameIndex = findIndex('firstname', 'name', 'operatorname');
  let lastNameIndex = findIndex('lastname', 'surname', 'familyname');
  let cityIndex = findIndex('city', 'town', 'locality', 'cidade');
  let stateIndex = findIndex('state', 'province', 'region', 'estado');
  let countryIndex = findIndex('country', 'countryname', 'pais');
  if (idIndex < 0 || callsignIndex < 0) {
    idIndex = 0; callsignIndex = 1; firstNameIndex = 2; cityIndex = 4; stateIndex = 5; countryIndex = 6;
  }
  const valueAt = (row: string[], index: number) => index >= 0 ? (row[index] ?? '').trim() : '';
  const records: Record<string, DmrIdRecord> = {};
  for (const row of rows.slice(1)) {
    const id = valueAt(row, idIndex);
    const callsign = valueAt(row, callsignIndex).toUpperCase();
    if (!/^\d{1,8}$/.test(id) || Number(id) < 1 || Number(id) > 0xffffff || !callsign) continue;
    const firstName = valueAt(row, firstNameIndex);
    const lastName = valueAt(row, lastNameIndex);
    records[id] = {
      id, callsign,
      name: [firstName, lastName].filter(Boolean).join(' ') || undefined,
      city: valueAt(row, cityIndex) || undefined,
      state: valueAt(row, stateIndex) || undefined,
      country: valueAt(row, countryIndex) || undefined
    };
  }
  if (!Object.keys(records).length) throw new Error('Não encontrei registos válidos. Verifique as colunas Radio ID e Callsign do CSV.');
  return records;
}

function cleanDmrIdRecords(value: unknown): Record<string, DmrIdRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const records: Record<string, DmrIdRecord> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d{1,8}$/.test(key) || Number(key) < 1 || Number(key) > 0xffffff || !raw || typeof raw !== 'object') continue;
    const item = raw as Partial<DmrIdRecord>;
    if (typeof item.callsign !== 'string' || !item.callsign.trim()) continue;
    const cleanText = (candidate: unknown, max: number) => typeof candidate === 'string' ? candidate.trim().slice(0, max) || undefined : undefined;
    records[key] = {
      id: key, callsign: item.callsign.trim().toUpperCase().slice(0, 16),
      name: cleanText(item.name, 64), city: cleanText(item.city, 64),
      state: cleanText(item.state, 64), country: cleanText(item.country, 64)
    };
  }
  return records;
}

function cleanSettings(value: Partial<AppSettings>): AppSettings {
  const theme: Theme = value.theme === 'light' || value.theme === 'dark' ? value.theme : 'auto';
  const cleanFrequency = (frequency: unknown): string => {
    const text = typeof frequency === 'number' && Number.isSafeInteger(frequency)
      ? String(frequency)
      : typeof frequency === 'string' ? frequency.trim() : '';
    return /^\d{9}$/.test(text) && text !== '000000000' ? text : DEFAULT_HOTSPOT_FREQUENCY_HZ;
  };
  const integerSetting = (candidate: unknown, fallback: number, min: number, max: number) =>
    Number.isInteger(candidate) ? Math.min(max, Math.max(min, Number(candidate))) : fallback;
  const totLimitSeconds = integerSetting(value.totLimitSeconds, 180, 30, 900);
  const serverType: ServerType = value.serverType === 'other' ? 'other' : 'brandmeister';
  const legacyPort=integerSetting(value.masterPort,62031,1,65535);
  const explicitProtocol=value.radioProtocol==='hbp'||value.radioProtocol==='odtp';
  const radioProtocol=explicitProtocol?value.radioProtocol!:serverType==='other'||![62030,62031,54006].includes(legacyPort)?'hbp':'odtp';
  const masterPort=!explicitProtocol&&radioProtocol==='odtp'&&[62030,62031].includes(legacyPort)?54006:legacyPort;
  const cleanCoordinate = (candidate: unknown, min: number, max: number): string => {
    const text = typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate).trim() : '';
    if (!text) return '';
    const number = Number(text);
    return Number.isFinite(number) && number >= min && number <= max ? number.toFixed(6) : '';
  };
  return {
    callsign: typeof value.callsign === 'string' ? value.callsign.trim().slice(0, 8) : '',
    dmrId: typeof value.dmrId === 'string' ? value.dmrId.trim().slice(0, 7) : '',
    essid: typeof value.essid === 'string' ? value.essid.trim().slice(0, 2) : '02',
    rxFrequencyHz: cleanFrequency(value.rxFrequencyHz),
    txFrequencyHz: cleanFrequency(value.txFrequencyHz),
    masterHost: (typeof value.masterHost === 'string' ? value.masterHost.trim().slice(0, 180) : '') || (serverType === 'brandmeister' ? '7242.master.brandmeister.network' : ''),
    masterPort,
    radioProtocol,
    serverType,
    staticTalkgroups: typeof value.staticTalkgroups === 'string' ? value.staticTalkgroups.replace(/[^\d,;\s]/g, '').slice(0, 500) : '',
    locationName: typeof value.locationName === 'string' ? value.locationName.trim().slice(0, 120) : '',
    latitude: cleanCoordinate(value.latitude, -90, 90),
    longitude: cleanCoordinate(value.longitude, -180, 180),
    defaultSlot: value.defaultSlot === 2 ? 2 : 1,
    theme,
    autoConnectOnStartup: value.autoConnectOnStartup !== false,
    autoReconnect: value.autoReconnect !== false,
    totLimitSeconds,
    totWarningSeconds: Math.min(integerSetting(value.totWarningSeconds, 10, 0, 120), totLimitSeconds - 1),
    totEnabled: value.totEnabled !== false,
    totVisualAlert: value.totVisualAlert !== false,
    totSoundAlert: value.totSoundAlert !== false,
    txGainPercent: integerSetting(value.txGainPercent, 100, 0, 200),
    rxVolumePercent: integerSetting(value.rxVolumePercent, 100, 0, 200),
    selectedTalkgroupId: Number.isInteger(value.selectedTalkgroupId) ? Number(value.selectedTalkgroupId) : 724,
    favorites: Array.isArray(value.favorites) ? [...new Set(value.favorites.filter(Number.isInteger))] as number[] : [724]
    ,console: value.console && typeof value.console === 'object' && !Array.isArray(value.console)
      ? (JSON.stringify(value.console).length <= 128000 ? JSON.parse(JSON.stringify(value.console)) : {}) : {},
    operation: value.operation && typeof value.operation === 'object' && !Array.isArray(value.operation)
      ? (JSON.stringify(value.operation).length <= 12000 ? JSON.parse(JSON.stringify(value.operation)) : {}) : {}
  };
}

export async function startServer(options: StartOptions = {}) {
  const app = express();
  const server = createServer(app);
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const mobileRelayServer = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const gateway = new BrandMeisterGateway();
  const serialPtt = new SppSerial();
  const lastHeard = new BrandMeisterLastHeardMonitor(options.lastHeardUrl ?? process.env.ZAPDMR_LASTHEARD_URL);
  const staticDir = options.staticDir ?? path.resolve(__dirname, '../../web');
  const talkgroupsFile = options.talkgroupsFile ?? path.resolve(__dirname, '../../data/talkgroups-brasil.json');
  const userDataDir = options.userDataDir ?? process.env.ZAPDMR_DATA_DIR ?? path.resolve(__dirname, '../../data');
  const aprs = new AprsClient(path.join(userDataDir, 'aprs-messages.json'));
  let voiceTarget: {id:number;callType:'group'|'private'} | null = null;
  const systemLog: Array<{at:number;level:string;message:string}> = [];
  const settingsFile = path.join(userDataDir, 'settings.json');
  const passwordFile = path.join(userDataDir, 'hotspot-password.dpapi');
  const communityFile=path.join(userDataDir,'community-profile.dpapi');
  let communityProfile:Record<string,any>={};
  const profilesFile = path.join(userDataDir, 'profiles.json');
  const profileSecretsDir = path.join(userDataDir, 'profile-secrets');
  const profileSecretFile = (profileId: string) => path.join(profileSecretsDir, `${profileId}.dpapi`);
  const customTalkgroupsFile = path.join(userDataDir, 'custom-talkgroups.json');
  const dmrIdDatabaseFile = path.join(userDataDir, 'dmr-id-database.json');
  const audioSidecarExe = options.audioSidecarExe ?? process.env.ZAPDMR_AUDIO_SIDECAR_EXE;
  const audioAssetsDir = options.audioAssetsDir ?? process.env.ZAPDMR_AUDIO_ASSETS_DIR;
  let settings = { ...DEFAULT_SETTINGS };
  let profiles: SavedProfile[] = [];
  let activeProfileId = 'default';
  const profilePasswordsConfigured = new Set<string>();
  let hotspotPassword: string | undefined;
  let passwordStoreError = false;
  let latestTelemetry: UdpTelemetry | null = null;
  let udpSocket: Awaited<ReturnType<typeof startUdpTelemetry>>['socket'] | undefined;
  let udpPort: number | null = null;
  let audioClient: AudioSidecarClient | undefined;
  let disconnectTalkgroupPending = false;
  let talkgroupBurstPending = false;
  let linkRevision=0,linkRequests=0,linkedSlot:1|2=1,rxTargetTalkgroupId=0;
  let linkQueue:Promise<unknown>=Promise.resolve();
  let rxAcceptedFrames=0,rxIgnoredFrames=0;
  let talkgroupBurstPurpose: 'disconnect' | 'link' | null = null;
  let talkgroupBurstTalkgroupId: number | null = null;
  let silenceCodewordRequest: {
    generation: number;
    resolve: (codewords: Buffer[]) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | undefined;
  let customTalkgroups: Talkgroup[] = [];
  let dmrIdRecords: Record<string, DmrIdRecord> = {};
  let directoryByCall: Map<string, DmrIdRecord> | null = null;
  let dmrIdDatabaseUpdatedAt: string | null = null;
  const participants = new Map<string, RoundParticipant>();
  let audioCaptureReady = false;
  let audioRenderReady = false;
  let audioLevelIdleTimer: NodeJS.Timeout | undefined;
  let totWarningTimer: NodeJS.Timeout | undefined;
  let totLimitTimer: NodeJS.Timeout | undefined;
  let totStartedAt: number | null = null;
  let audioTestRunning = false;
  let lastReceivedTalkgroupId: number | null = null;
  let currentAudioLevel: {
    level: number; direction: 'IDLE' | 'TX' | 'RX'; callsign: string; callerName: string; talkgroupId: number | null;
  } = { level: 0, direction: 'IDLE', callsign: '', callerName: '', talkgroupId: null };
  let shuttingDown = false;
  let audioSidecar: { state: string; status?: string; error?: AudioSidecarError | { ok: false; code: 'INVALID_ERROR_FRAME'; message: string } } = {
    state: 'not-configured'
  };
  let connectionWanted = false;
  let reconnecting = false;
  let reconnectMessage = '';
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  const mobileClients = new Set<WebSocket>();
  const mobileRelayToken = process.env.ZAPDMR_MOBILE_RELAY_TOKEN ?? '';
  let mobileController: WebSocket | undefined;
  let mobilePttTalkgroupId: number | undefined;
  let nextReconnectAt: string | null = null;
  let audioRestartAttempt = 0;
  let audioRestartTimer: NodeJS.Timeout | undefined;
  let audioLaunchGeneration = 0;
  const reconnectDelaysMs = [3000, 5000, 10000, 15000, 30000, 60000];
  const audioRestartDelaysMs = [2000, 5000, 10000, 15000, 30000, 60000];
  const retryableGatewayErrors = new Set([
    'UDP_ERROR', 'UDP_SEND_FAILED', 'UDP_CONNECT_FAILED', 'HBP_TIMEOUT', 'ODTP_TIMEOUT', 'ODTP_FAILED',
    'MASTER_TIMEOUT', 'MASTER_CLOSED', 'MASTER_UNREACHABLE'
  ]);

  await fs.mkdir(userDataDir, { recursive: true });
  try {const value=await loadWindowsSecret(communityFile);if(value)communityProfile=JSON.parse(value);}catch{}
  await aprs.load();
  try { gateway.restoreUsage(JSON.parse(await fs.readFile(path.join(userDataDir,'data-usage.json'),'utf8'))); } catch {}
  try {
    const savedTalkgroups: unknown = JSON.parse(await fs.readFile(customTalkgroupsFile, 'utf8'));
    if (Array.isArray(savedTalkgroups)) {
      customTalkgroups = savedTalkgroups.filter((item): item is Talkgroup => {
        if (!item || typeof item !== 'object') return false;
        const group = item as Partial<Talkgroup>;
        return Number.isInteger(group.id) && Number(group.id) > 0 && Number(group.id) <= 0xffffff &&
          typeof group.name === 'string' && group.name.trim().length > 0 &&
          (group.slot === 1 || group.slot === 2) && typeof group.category === 'string' &&
          CUSTOM_TALKGROUP_CATEGORIES.has(group.category) && group.kind === 'group';
      }).map((group) => ({ ...group, name: group.name.trim().slice(0, 60), custom: true }));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn('ZapDMR: não foi possível carregar as TalkGroups personalizadas:', (error as Error).message);
  }
  try { settings = cleanSettings(JSON.parse(await fs.readFile(settingsFile, 'utf8')) as Partial<AppSettings>); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    const saved = JSON.parse(await fs.readFile(profilesFile, 'utf8')) as { activeProfileId?: unknown; profiles?: unknown };
    if (Array.isArray(saved.profiles)) {
      profiles = saved.profiles.flatMap((raw): SavedProfile[] => {
        if (!raw || typeof raw !== 'object') return [];
        const value = raw as Partial<SavedProfile>;
        const id = typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value.id) ? value.id : '';
        if (!id || !value.settings || typeof value.settings !== 'object') return [];
        const name = typeof value.name === 'string' ? value.name.trim().slice(0, 40) : '';
        return [{ id, name: name || 'Perfil', settings: cleanSettings(value.settings as Partial<AppSettings>) }];
      });
      if (profiles.length) {
        activeProfileId = profiles.some((profile) => profile.id === saved.activeProfileId)
          ? String(saved.activeProfileId) : profiles[0].id;
        settings = profiles.find((profile) => profile.id === activeProfileId)!.settings;
      }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('ZapDMR: não foi possível carregar os perfis:', (error as Error).message); }
  if (!profiles.length) profiles = [{ id: 'default', name: settings.callsign || 'Perfil principal', settings: { ...settings } }];
  try {
    const activeSecretFile = profileSecretFile(activeProfileId);
    hotspotPassword = await loadWindowsSecret(activeSecretFile) ??
      (activeProfileId === 'default' ? await loadWindowsSecret(passwordFile) : undefined);
    if (hotspotPassword) profilePasswordsConfigured.add(activeProfileId);
  }
  catch (error) {
    passwordStoreError = true;
    console.warn('ZapDMR: não foi possível ler a senha protegida pelo Windows DPAPI:', (error as Error).message);
  }
  const persistProfiles = async () => {
    const temporaryFile = `${profilesFile}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify({ activeProfileId, profiles }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, profilesFile);
  };
  const profileMetadata = async () => Promise.all(profiles.map(async (profile) => {
    let passwordConfigured = profilePasswordsConfigured.has(profile.id);
    if (!passwordConfigured) {
      passwordConfigured = await fs.access(profileSecretFile(profile.id)).then(() => true).catch(() => false);
      if (profile.id === 'default' && !passwordConfigured)
        passwordConfigured = await fs.access(passwordFile).then(() => true).catch(() => false);
    }
    return {
      id: profile.id, name: profile.name, callsign: profile.settings.callsign, dmrId: profile.settings.dmrId,
      serverType: profile.settings.serverType, masterHost: profile.settings.masterHost,
      active: profile.id === activeProfileId, passwordConfigured
    };
  }));

  try {
    const savedDatabase = JSON.parse(await fs.readFile(dmrIdDatabaseFile, 'utf8')) as {
      updatedAt?: unknown; records?: unknown;
    };
    if (savedDatabase.records && typeof savedDatabase.records === 'object' && !Array.isArray(savedDatabase.records)) {
      dmrIdRecords = cleanDmrIdRecords(savedDatabase.records);
      dmrIdDatabaseUpdatedAt = typeof savedDatabase.updatedAt === 'string' ? savedDatabase.updatedAt : null;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn('ZapDMR: não foi possível carregar a base local DMR ID:', (error as Error).message);
  }

  const databaseMetadata = () => ({
    records: Object.keys(dmrIdRecords).length,
    bytes: Buffer.byteLength(JSON.stringify({ updatedAt: dmrIdDatabaseUpdatedAt, records: dmrIdRecords }), 'utf8'),
    updatedAt: dmrIdDatabaseUpdatedAt
  });
  const participantSnapshot = (talkgroupId = Number(settings.selectedTalkgroupId)) => {
    const cutoff = Date.now() - PARTICIPANT_RETENTION_MS;
    for (const [key, participant] of participants) if (participant.at < cutoff) participants.delete(key);
    return [...participants.values()].filter((participant) => participant.talkgroupId === talkgroupId)
      .sort((left, right) => right.at - left.at).slice(0, 50);
  };
  const rememberParticipant = (input: {
    talkgroupId: number; sourceId?: string | number; callsign?: string; name?: string;
    location?: string; country?: string; at?: number; event?: string;
  }) => {
    const idText = input.sourceId === undefined ? '' : String(input.sourceId).trim();
    const record = idText ? dmrIdRecords[idText] : undefined;
    const callsign = (record?.callsign || input.callsign || (idText ? `ID ${idText}` : '')).trim().toUpperCase();
    if (!Number.isInteger(input.talkgroupId) || input.talkgroupId < 1 || input.talkgroupId > 0xffffff || !callsign) return;
    const validPlace = (value?: string) => value && /[\p{L}]/u.test(value) && !/^(?:slot|ts|time\s*slot)\s*[:#-]?\s*\d+$/i.test(value.trim()) ? value.trim() : '';
    const location = [record?.city, record?.state].filter(Boolean).join(', ') || validPlace(input.location);
    const country = record?.country || validPlace(input.country);
    const key = `${input.talkgroupId}:${idText || callsign}`;
    const participant: RoundParticipant = {
      key, talkgroupId: input.talkgroupId, sourceId: idText || undefined, callsign,
      name: record?.name || input.name?.trim() || '', location: location || '', country,
      city: record?.city, state: record?.state,
      at: Number.isFinite(input.at) ? Number(input.at) : Date.now(), event: input.event
    };
    participants.set(key, participant);
    const cutoff = Date.now() - PARTICIPANT_RETENTION_MS;
    for (const [participantKey, seen] of participants) if (seen.at < cutoff) participants.delete(participantKey);
    while (participants.size > MAX_PARTICIPANTS) participants.delete(participants.keys().next().value!);
    broadcast('participant', participant);
  };

  const status = () => ({ server: 'ready', target:voiceTarget||{id:settings.selectedTalkgroupId,callType:'group'}, usage:gateway.usageSnapshot(), spp:serialPtt.snapshot(), rxReception:{targetTalkgroupId:rxTargetTalkgroupId||settings.selectedTalkgroupId,acceptedFrames:rxAcceptedFrames,ignoredFrames:rxIgnoredFrames}, brandmeister: gateway.status(), disconnectTalkgroupPending,
    talkgroupBurst: { pending: talkgroupBurstPending, purpose: talkgroupBurstPurpose, talkgroupId: talkgroupBurstTalkgroupId },
    brandmeisterLastHeard: lastHeard.status(),
    talkgroupActivity: gateway.talkgroupActivitySnapshot(),
    participants: participantSnapshot(),
    dmrIdDatabase: databaseMetadata(),
    tot: {
      active: Boolean(gateway.status().pttArmed),
      startedAt: totStartedAt,
      limitSeconds: settings.totLimitSeconds,
      warningSeconds: settings.totWarningSeconds
    },
    connectionAutomation: {
      autoConnectOnStartup: settings.autoConnectOnStartup,
      autoReconnect: settings.autoReconnect,
      reconnecting,
      message: reconnectMessage,
      retryAttempt: reconnectAttempt,
      nextReconnectAt
    },
    udpTelemetry: { host: '127.0.0.1', port: udpPort, enabled: udpPort !== null },
    audioSidecar, latestTelemetry, audioLevel: currentAudioLevel });
  const sendMobile = (client: WebSocket, event: string, data: unknown) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ event, data }));
  };
  const broadcast = (event: string, data: unknown) => {
    const packet = JSON.stringify({ event, data });
    for (const client of wsServer.clients) if (client.readyState === WebSocket.OPEN) client.send(packet);
    for (const client of mobileClients) if (client.readyState === WebSocket.OPEN) client.send(packet);
  };
  const log = (message:string,level='info') => {const entry={at:Date.now(),level,message:message.slice(0,300)};systemLog.push(entry);if(systemLog.length>500)systemLog.shift();broadcast('systemLog',entry);};
  for(const event of ['status','message','station'])aprs.on(event,data=>broadcast('aprs',{event,data}));
  let usageSaving=false;
  const usageTimer=setInterval(()=>{if(usageSaving)return;usageSaving=true;broadcast('usage',gateway.usageSnapshot());void fs.writeFile(path.join(userDataDir,'data-usage.json'),JSON.stringify(gateway.usageSnapshot()),{mode:0o600}).catch(()=>{}).finally(()=>{usageSaving=false;});},5000);usageTimer.unref();
  serialPtt.configure(settings.operation);
  serialPtt.on('status',data=>broadcast('sppStatus',data));
  serialPtt.on('learned',data=>{settings.operation=data.operation;const profile=profiles.find(item=>item.id===activeProfileId);if(profile)profile.settings={...settings};void fs.writeFile(settingsFile,JSON.stringify(settings,null,2),{mode:0o600});void persistProfiles();broadcast('sppLearned',data);});
  serialPtt.on('action',action=>broadcast('hardwareButton',{action}));
  const clearTotTimers = () => {
    if (totWarningTimer) clearTimeout(totWarningTimer);
    if (totLimitTimer) clearTimeout(totLimitTimer);
    totWarningTimer = undefined;
    totLimitTimer = undefined;
    totStartedAt = null;
  };
  const armTotTimers = (startedAt = Date.now()) => {
    clearTotTimers();
    if(settings.totEnabled===false)return;
    totStartedAt = startedAt;
    const limitMs = settings.totLimitSeconds * 1000;
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    if (settings.totWarningSeconds > 0 && settings.totWarningSeconds < settings.totLimitSeconds) {
      const warningDelay = Math.max(0, limitMs - settings.totWarningSeconds * 1000 - elapsedMs);
      totWarningTimer = setTimeout(() => {
        broadcast('tot-warning', {
          secondsRemaining: settings.totWarningSeconds,
          visual: settings.totVisualAlert, sound: settings.totSoundAlert
        });
      }, warningDelay);
    }
    totLimitTimer = setTimeout(() => {
      const talkgroupId = Number(gateway.status().talkgroupId ?? settings.selectedTalkgroupId);
      if (mobilePttTalkgroupId !== undefined) {
        mobilePttTalkgroupId = undefined;
        try { audioClient?.send(AudioSidecarMessage.setRemoteAudio, Buffer.from([0])); } catch { /* PTT release continues. */ }
        if (mobileController) sendMobile(mobileController, 'ptt-stopped', { accepted: true, code: 'TOT_EXPIRED', message: 'PTT móvel liberado pelo TOT.' });
      }
      try {
        if (audioClient) {
          const payload = Buffer.alloc(5); payload[0] = 0; payload.writeUInt32LE(talkgroupId, 1);
          audioClient.send(AudioSidecarMessage.setPtt, payload);
        }
      } catch (error) { console.warn('ZapDMRAudio TOT release:', (error as Error).message); }
      void gateway.setPtt(false, talkgroupId).finally(() => {
        clearTotTimers();
        broadcast('tot-expired', { talkgroupId, limitSeconds: settings.totLimitSeconds });
        broadcast('status', status());
      });
    }, Math.max(0, limitMs - elapsedMs));
    broadcast('status', status());
  };
  const clearAudioMeter = () => {
    if (audioLevelIdleTimer) clearTimeout(audioLevelIdleTimer);
    audioLevelIdleTimer = undefined;
    currentAudioLevel = { level: 0, direction: 'IDLE', callsign: '', callerName: '', talkgroupId: null };
    broadcast('audio-level', currentAudioLevel);
  };
  const updateAudioMeter = (direction: 'TX' | 'RX', level: number) => {
    if (!Number.isInteger(level) || level < 0 || level > 100) return;
    if (audioLevelIdleTimer) clearTimeout(audioLevelIdleTimer);
    audioLevelIdleTimer = undefined;
    if (level === 0) return clearAudioMeter();
    const talkgroupId = direction === 'TX'
      ? Number(gateway.status().talkgroupId ?? settings.selectedTalkgroupId)
      : Number(voiceTarget?.id||rxTargetTalkgroupId||settings.selectedTalkgroupId);
    const activity = talkgroupId === null ? undefined : gateway.talkgroupActivitySnapshot()[String(talkgroupId)];
    currentAudioLevel = {
      level,
      direction,
      callsign: direction === 'TX' ? settings.callsign : activity?.lastCallerCallsign ?? '',
      callerName: direction === 'RX' ? activity?.lastCallerName ?? '' : '',
      talkgroupId
    };
    broadcast('audio-level', currentAudioLevel);
    audioLevelIdleTimer = setTimeout(clearAudioMeter, 350);
  };
  lastHeard.on('activity', (activity) => gateway.noteGlobalTalkgroupActivity(activity));
  lastHeard.on('participant', (participant: {
    talkgroupId: number; sourceId?: string; callsign?: string; name?: string;
    location?: string; country?: string; at?: number; event?: string;
  }) => rememberParticipant(participant));
  lastHeard.on('status', () => broadcast('status', status()));
  const finishSilenceCodewordRequest = (error?: Error, codewords?: Buffer[]) => {
    const pending = silenceCodewordRequest;
    if (!pending) return;
    silenceCodewordRequest = undefined;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(codewords ?? []);
  };
  const requestSilenceCodewords = (client: AudioSidecarClient, generation: number): Promise<Buffer[]> => {
    if (silenceCodewordRequest) return Promise.reject(new Error('Já existe um pedido de silêncio em andamento.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finishSilenceCodewordRequest(new Error('O vocoder não respondeu ao pedido de áudio silencioso.')), 3000);
      silenceCodewordRequest = { generation, resolve, reject, timer };
      try { client.send(AudioSidecarMessage.encodeSilence, Buffer.from([DISCONNECT_SILENCE_CODEWORDS])); }
      catch (error) { finishSilenceCodewordRequest(error as Error); }
    });
  };
  const clearReconnect = (resetAttempts = false) => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    nextReconnectAt = null;
    reconnecting = false;
    reconnectMessage = '';
    if (resetAttempts) reconnectAttempt = 0;
  };
  const scheduleReconnect = (reason: string) => {
    if (shuttingDown || !connectionWanted || !settings.autoReconnect || reconnectTimer) return;
    const limit=Math.max(1,Math.min(50,Number((settings.console as any)?.network?.maxReconnectAttempts)||5));
    if(reconnectAttempt>=limit){reconnecting=false;reconnectMessage=`Reconexão interrompida após ${limit} tentativas. Volte a ligar para tentar novamente.`;log(reconnectMessage,'error');broadcast('status',status());return;}
    const baseDelay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
    const jitter = Math.round(baseDelay * (Math.random() * 0.2 - 0.1));
    const delayMs = Math.max(1000, baseDelay + jitter);
    reconnectAttempt += 1;
    reconnecting = true;
    reconnectMessage = `Conexão perdida. Reconectando em ${Math.ceil(delayMs / 1000)} s (tentativa ${reconnectAttempt}). ${reason}`;
    nextReconnectAt = new Date(Date.now() + delayMs).toISOString();
    broadcast('status', status());
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      nextReconnectAt = null;
      if (shuttingDown || !connectionWanted || !settings.autoReconnect) {
        reconnecting = false;
        broadcast('status', status());
        return;
      }
      void attemptConnection(true);
    }, delayMs);
  };
  const attemptConnection = async (automatic: boolean) => {
    if (shuttingDown || !connectionWanted) return { accepted: false, code: 'CANCELLED', message: 'Ligação cancelada.' };
    reconnecting = automatic;
    reconnectMessage = automatic ? 'Tentando restabelecer a sessão com o master…' : '';
    broadcast('status', status());
    const result = await gateway.connect(settings, hotspotPassword);
    log(`${automatic?'Reconexão':'Ligação'} HBP: ${result.code}` ,result.accepted?'info':'error');
    if (result.accepted) {
      clearReconnect(true);
      broadcast('status', status());
    } else {
      reconnecting = false;
      reconnectMessage = '';
      broadcast('status', status());
      if (settings.autoReconnect && connectionWanted && retryableGatewayErrors.has(result.code)) scheduleReconnect(result.message);
    }
    return result;
  };
  const scheduleAudioRestart = (message: string, expectedGeneration?: number) => {
    if (expectedGeneration !== undefined && expectedGeneration !== audioLaunchGeneration) return;
    const previousClient = audioClient;
    clearTotTimers();
    finishSilenceCodewordRequest(new Error('O áudio auxiliar foi reiniciado durante o comando TG 4000.'));
    audioClient = undefined;
    clearAudioMeter();
    audioLaunchGeneration += 1;
    audioCaptureReady = false;
    audioRenderReady = false;
    gateway.setAudioReady(false);
    const gatewayState = gateway.status();
    if (gatewayState.pttArmed)
      void gateway.setPtt(false, Number(gatewayState.talkgroupId ?? settings.selectedTalkgroupId));
    try { previousClient?.close(true); } catch { /* process may already have exited */ }
    if (shuttingDown || !audioSidecarExe) {
      audioSidecar = { state: 'error', status: message };
      broadcast('status', status());
      return;
    }
    if (audioRestartTimer) return;
    const delayMs = audioRestartDelaysMs[Math.min(audioRestartAttempt, audioRestartDelaysMs.length - 1)];
    audioRestartAttempt += 1;
    audioSidecar = {
      state: 'reconnecting',
      status: `${message} Reiniciando o áudio em ${Math.ceil(delayMs / 1000)} s (tentativa ${audioRestartAttempt}).`
    };
    broadcast('status', status());
    audioRestartTimer = setTimeout(() => {
      audioRestartTimer = undefined;
      void launchAudioSidecar();
    }, delayMs);
  };
  const launchAudioSidecar = async () => {
    if (shuttingDown || !audioSidecarExe) return;
    if (process.platform !== 'win32') {
      audioSidecar = { state: 'unsupported-platform', status: 'ZapDMRAudio.exe requer Windows x64.' };
      broadcast('status', status());
      return;
    }
    const generation = ++audioLaunchGeneration;
    audioCaptureReady = false;
    audioRenderReady = false;
    audioSidecar = {
      state: audioRestartAttempt ? 'reconnecting' : 'connecting',
      status: audioRestartAttempt ? 'Abrindo o processo auxiliar e o Named Pipe…' : undefined
    };
    broadcast('status', status());
    try {
      const args = [...(audioAssetsDir ? ['--assets-dir', audioAssetsDir] : []),...(options.audioPipeName?['--pipe',options.audioPipeName]:[])];
      const client = await AudioSidecarClient.launch(audioSidecarExe, args, {
        pipeName:options.audioPipeName,
        onStatus: (message) => {
          if (generation !== audioLaunchGeneration || shuttingDown) return;
          if (message.startsWith('AUDIO_STARTING')) {
            audioCaptureReady = false;
            audioRenderReady = false;
          } else if (message.startsWith('CAPTURE_READY')) {
            audioCaptureReady = true;
          } else if (message.startsWith('RENDER_READY')) {
            audioRenderReady = true;
          } else if (message.startsWith('CAPTURE_ERROR')) {
            audioCaptureReady = false;
            console.warn('Microfone indisponível; recepção mantida:', message);
          } else if (message.startsWith('RENDER_ERROR')) {
            scheduleAudioRestart(message, generation);
            return;
          } else if (message.startsWith('AUDIO_STOPPED')) {
            audioCaptureReady = false;
            audioRenderReady = false;
          }

          const ready = audioCaptureReady && audioRenderReady;
          if (ready) audioRestartAttempt = 0;
          gateway.setAudioReady(ready);
          audioSidecar = audioRenderReady
            ? { state: 'ready', status: audioCaptureReady ? message : 'Recepção pronta; microfone indisponível. ' + message }
            : { state: audioRestartAttempt ? 'reconnecting' : 'starting', status: message };
          broadcast('status', status());
        },
        onSidecarError: (error) => {
          if (generation !== audioLaunchGeneration || shuttingDown) return;
          scheduleAudioRestart(error.message, generation);
        },
        onMessage: (message) => {
          if (generation !== audioLaunchGeneration) return;
          if (message.type === AudioSidecarMessage.audioLevel) {
            if (message.payload.length !== 2) return;
            const direction = message.payload[0] === 1 ? 'TX' : message.payload[0] === 2 ? 'RX' : undefined;
            if (direction) updateAudioMeter(direction, message.payload[1]);
            return;
          }
          if (message.type === AudioSidecarMessage.rxPcm) {
            if (message.payload.length !== 320) return;
            for (const mobileClient of mobileClients) {
              if (mobileClient.readyState === WebSocket.OPEN && mobileClient.bufferedAmount < 256 * 1024)
                mobileClient.send(message.payload, { binary: true });
            }
            return;
          }
          if (message.type === AudioSidecarMessage.silenceFec) {
            if (!silenceCodewordRequest || silenceCodewordRequest.generation !== generation) return;
            const expectedLength = DISCONNECT_SILENCE_CODEWORDS * 9;
            if (message.payload.length !== expectedLength) {
              finishSilenceCodewordRequest(new Error(`O vocoder retornou ${message.payload.length} bytes de silêncio; esperados ${expectedLength}.`));
            } else {
              const codewords = Array.from({ length: DISCONNECT_SILENCE_CODEWORDS }, (_, index) =>
                Buffer.from(message.payload.subarray(index * 9, (index + 1) * 9)));
              finishSilenceCodewordRequest(undefined, codewords);
            }
            return;
          }
          if (message.type !== AudioSidecarMessage.txFec) return;
          void gateway.pushVoiceCodeword(message.payload).then((result) => {
            if (!result.accepted && result.code !== 'PTT_NOT_ARMED')
              console.warn('ZapDMRAudio TX:', result.message);
          }).catch((error) => console.warn('ZapDMRAudio TX:', (error as Error).message));
        },
        onStderr: (text) => console.warn('ZapDMRAudio:', text.trimEnd())
      });
      if (generation !== audioLaunchGeneration || shuttingDown) {
        client.close(true);
        return;
      }
      audioClient = client;
      client.on('pipeClose', () => {
        if (!shuttingDown) scheduleAudioRestart('Named Pipe do ZapDMRAudio foi fechado.', generation);
      });
      client.on('transportError', (error: Error) => {
        if (!shuttingDown) scheduleAudioRestart(`Erro no Named Pipe do ZapDMRAudio: ${error.message}`, generation);
      });
      client.on('processError', (error: Error) => {
        if (!shuttingDown) scheduleAudioRestart(`Falha ao iniciar ZapDMRAudio: ${error.message}`, generation);
      });
      client.on('exit', ({ code, signal }: { code: number | null; signal: NodeJS.Signals | null }) => {
        if (!shuttingDown) scheduleAudioRestart(`ZapDMRAudio encerrou (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`, generation);
      });
      client.send(AudioSidecarMessage.hello);
      client.send(AudioSidecarMessage.startAudio);
      client.send(AudioSidecarMessage.setTxGain, Buffer.from([settings.txGainPercent]));
      client.send(AudioSidecarMessage.setRxVolume, Buffer.from([settings.rxVolumePercent]));
    } catch (error) {
      if (generation === audioLaunchGeneration && !shuttingDown) {
        console.warn('ZapDMRAudio indisponível:', (error as Error).message);
        scheduleAudioRestart((error as Error).message, generation);
      }
    }
  };
  gateway.on('status', (gatewayStatus) => {
    if (gatewayStatus.connected) clearReconnect(true);
    if (!gatewayStatus.pttArmed && totStartedAt !== null) clearTotTimers();
    else if (gatewayStatus.state === 'error' && connectionWanted && settings.autoReconnect && !(talkgroupBurstPending&&talkgroupBurstPurpose==='link') &&
        typeof gatewayStatus.errorCode === 'string' && retryableGatewayErrors.has(gatewayStatus.errorCode))
      scheduleReconnect(gatewayStatus.message || 'O master encerrou a sessão.');
    broadcast('status', status());
  });
  gateway.on('frame', (packet: Buffer) => {
    lastReceivedTalkgroupId = packet.readUIntBE(8, 3);
    if((packet[15]&0x20)!==0)console.log(`[RX DMRD] TG ${lastReceivedTalkgroupId}, origem ${packet.readUIntBE(5,3)}, flags ${packet[15]}.`);
    if((packet[15]&0x40)===0)rememberParticipant({ talkgroupId: lastReceivedTalkgroupId, sourceId: packet.readUIntBE(5, 3), at: Date.now(), event: 'DMRD' });
    const matchesTarget=gateway.isSelectedVoicePacket(packet,voiceTarget?.id||Number(rxTargetTalkgroupId||settings.selectedTalkgroupId),voiceTarget?.callType||'group');
    if (audioClient && audioSidecar.state === 'ready' && !audioTestRunning && !talkgroupBurstPending && matchesTarget) {
      rxAcceptedFrames++;
      for (const codeword of gateway.receiveVoiceCodewords(packet)) {
        try { audioClient.send(AudioSidecarMessage.rxFec, codeword); }
        catch (error) { console.warn('ZapDMRAudio RX:', (error as Error).message); break; }
      }
    }
    if(!matchesTarget)rxIgnoredFrames++;
    broadcast('dmr-frame', {
      length: packet.length, talkgroupId: packet.readUIntBE(8, 3), receivedAt: new Date().toISOString()
    });
  });
  gateway.on('talkgroup-activity', (activity: { id: number; lastActivityAt: number; lastCallerCallsign?: string; lastCallerName?: string; active?: boolean }) =>
    broadcast('talkgroup-activity', activity));
  const resultStatus = (result: { accepted: boolean; code: string }) => {
    if (result.accepted) return 200;
    if (result.code.startsWith('INVALID_')) return 400;
    if (result.code === 'AUTH_REJECTED') return 401;
    if (result.code === 'MASTER_UNREACHABLE' || result.code === 'UDP_ERROR' || result.code === 'MASTER_TIMEOUT' || result.code === 'MASTER_CLOSED' || result.code === 'UDP_SEND_FAILED') return 502;
    if (result.code === 'HBP_TIMEOUT') return 504;
    if (result.code === 'ALREADY_CONNECTED' || result.code === 'NOT_CONNECTED' || result.code === 'PTT_NOT_ARMED' || result.code === 'AUDIO_UNAVAILABLE' || result.code === 'TRANSMISSION_BUSY') return 409;
    return 422;
  };

  const releaseMobilePtt = async (client?: WebSocket) => {
    const talkgroupId = mobilePttTalkgroupId;
    if (talkgroupId === undefined) return;
    mobilePttTalkgroupId = undefined;
    try {
      if (audioClient) {
        const payload = Buffer.alloc(5);
        payload[0] = 0;
        payload.writeUInt32LE(talkgroupId, 1);
        audioClient.send(AudioSidecarMessage.setPtt, payload);
        audioClient.send(AudioSidecarMessage.setRemoteAudio, Buffer.from([0]));
      }
    } catch (error) { console.warn('ZapDMR mobile PTT release:', (error as Error).message); }
    const result = await gateway.setPtt(false, talkgroupId);
    if (client) sendMobile(client, 'ptt-stopped', result);
    broadcast('status', status());
  };

  const secureMobileTransport = (request: import('node:http').IncomingMessage) => {
    const encrypted = Boolean((request.socket as import('node:tls').TLSSocket).encrypted);
    const proxyHttps = process.env.ZAPDMR_MOBILE_TRUST_PROXY === '1' &&
      (request.headers['x-forwarded-proto'] ?? '').toString().split(',')[0].trim().toLowerCase() === 'https';
    return encrypted || proxyHttps;
  };
  const isLoopback = (address = '') => address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.');

  server.on('upgrade', (request, socket, head) => {
    let pathname = '';
    try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (pathname === '/ws') {
      if (!isLoopback(request.socket.remoteAddress ?? '')) { socket.destroy(); return; }
      wsServer.handleUpgrade(request, socket, head, (client) => wsServer.emit('connection', client, request));
      return;
    }
    if (pathname !== '/mobile-ws') { socket.destroy(); return; }
    const rejectUpgrade = (code: string, message: string) => {
      const body = JSON.stringify({ error: message });
      socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      socket.destroy();
    };
    if (!mobileRelayToken || Buffer.byteLength(mobileRelayToken) < 32) {
      rejectUpgrade('503 Service Unavailable', 'Relay móvel desativado: configure ZAPDMR_MOBILE_RELAY_TOKEN com pelo menos 32 bytes.');
      return;
    }
    if (!secureMobileTransport(request)) {
      rejectUpgrade('426 Upgrade Required', 'O relay móvel aceita apenas WebSocket protegido com TLS (WSS).');
      return;
    }
    if (!isLoopback(request.socket.remoteAddress ?? '') && process.env.ZAPDMR_BIND_HOST !== '0.0.0.0') {
      rejectUpgrade('403 Forbidden', 'O relay só está acessível na interface local.');
      return;
    }
    if (mobileClients.size > 0 || mobileRelayServer.clients.size >= 4) {
      rejectUpgrade('409 Conflict', 'Já existe um cliente móvel ativo.');
      return;
    }
    mobileRelayServer.handleUpgrade(request, socket, head, (client) => {
      mobileRelayServer.emit('connection', client, request);
    });
  });

  mobileRelayServer.on('connection', (client) => {
    let authenticated = false;
    let closed = false;
    const authTimeout = setTimeout(() => client.close(4401, 'Authentication timeout'), 10_000);
    const rejectMobileMessage = (message: string) => sendMobile(client, 'error', { message });
    const onMobileMessage = async (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (!authenticated || client !== mobileController || mobilePttTalkgroupId === undefined || !audioClient || audioSidecar.state !== 'ready') return;
        if (pcm.length !== 320 || client.bufferedAmount > 256 * 1024) {
          rejectMobileMessage(pcm.length !== 320 ? 'Quadro PCM inválido: esperado 320 bytes a 8 kHz/16-bit.' : 'A fila de áudio está congestionada; solte o PTT e tente novamente.');
          await releaseMobilePtt(client);
          return;
        }
        try { audioClient.send(AudioSidecarMessage.encodePcm, pcm); }
        catch (error) { rejectMobileMessage(`Falha ao enviar áudio ao vocoder: ${(error as Error).message}`); await releaseMobilePtt(client); }
        return;
      }
      let message: Record<string, unknown>;
      try {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8');
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid shape');
        message = parsed as Record<string, unknown>;
      } catch { rejectMobileMessage('Comando móvel inválido.'); return; }

      if (!authenticated) {
        if (message.type !== 'auth' || typeof message.token !== 'string') { client.close(4401, 'Authentication required'); return; }
        const supplied = Buffer.from(message.token, 'utf8');
        const expected = Buffer.from(mobileRelayToken, 'utf8');
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { client.close(4401, 'Authentication failed'); return; }
        if (mobileController && mobileController.readyState === WebSocket.OPEN) { client.close(4409, 'Another mobile client is active'); return; }
        authenticated = true;
        mobileController = client;
        mobileClients.add(client);
        clearTimeout(authTimeout);
        sendMobile(client, 'authenticated', { mobileRelay: true, audioReady: audioSidecar.state === 'ready', status: status() });
        return;
      }
      if (client !== mobileController) { client.close(4403, 'Not the active controller'); return; }

      if (message.type === 'connect') {
        if (!audioClient || audioSidecar.state !== 'ready') {
          rejectMobileMessage('Vocoder e áudio auxiliar indisponíveis no gateway Windows.');
          return;
        }
        const profileValue = message.settings;
        if (!profileValue || typeof profileValue !== 'object' || Array.isArray(profileValue)) { rejectMobileMessage('Perfil HBP não informado.'); return; }
        const profile = cleanSettings(profileValue as Partial<AppSettings>);
        const password = typeof message.password === 'string' ? message.password.slice(0, 64) : '';
        if (!password) { rejectMobileMessage('Informe a Hotspot Security Password no perfil móvel.'); return; }
        settings = profile;
        hotspotPassword = password;
        connectionWanted = true;
        clearReconnect(true);
        gateway.setAudioReady(true);
        if (gateway.status().connected) {
          sendMobile(client, 'connect-result', { accepted: true, code: 'ALREADY_CONNECTED', message: 'O gateway já está ligado ao master.', status: status() });
          return;
        }
        const result = await gateway.connect(profile, password);
        sendMobile(client, 'connect-result', { ...result, status: status() });
        return;
      }
      if (message.type === 'disconnect') {
        await releaseMobilePtt(client);
        connectionWanted = false;
        clearReconnect(true);
        const result = await gateway.disconnect();
        sendMobile(client, 'disconnect-result', result);
        broadcast('status', status());
        return;
      }
      if (message.type === 'ptt-start') {
        if (!gateway.status().connected || !audioClient || audioSidecar.state !== 'ready') {
          rejectMobileMessage('Ligue o gateway HBP e confirme que o vocoder está pronto antes do PTT.');
          return;
        }
        if (mobilePttTalkgroupId !== undefined) { rejectMobileMessage('Já existe um PTT móvel ativo.'); return; }
        const talkgroupId = Number(message.talkgroupId);
        const slot = Number(message.slot) === 2 ? 2 : 1;
        const result = await gateway.setPtt(true, talkgroupId, slot);
        if (!result.accepted) { sendMobile(client, 'ptt-result', result); return; }
        try {
          audioClient.send(AudioSidecarMessage.setRemoteAudio, Buffer.from([1]));
          const payload = Buffer.alloc(5); payload[0] = 1; payload.writeUInt32LE(talkgroupId, 1);
          audioClient.send(AudioSidecarMessage.setPtt, payload);
          mobilePttTalkgroupId = talkgroupId;
          armTotTimers();
          sendMobile(client, 'ptt-result', { ...result, active: true });
        } catch (error) {
          await gateway.setPtt(false, talkgroupId);
          sendMobile(client, 'ptt-result', { accepted: false, code: 'AUDIO_PIPE_FAILED', message: (error as Error).message });
        }
        return;
      }
      if (message.type === 'ptt-stop') { await releaseMobilePtt(client); return; }
      rejectMobileMessage('Comando móvel desconhecido.');
    };

    client.on('message', (data, isBinary) => { void onMobileMessage(data as Buffer | ArrayBuffer | Buffer[], isBinary); });
    client.on('close', () => {
      clearTimeout(authTimeout);
      mobileClients.delete(client);
      if (mobileController === client) {
        mobileController = undefined;
        if (mobilePttTalkgroupId !== undefined) void releaseMobilePtt();
      }
    });
    client.on('error', (error) => console.warn('ZapDMR mobile WSS:', error.message));
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64mb' }));
  app.use((req, res, next) => {
    if (!isLoopback(req.socket.remoteAddress ?? '')) return res.status(403).json({ error: 'A API HTTP local do ZapDMR não aceita acesso remoto.' });
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'ZapDMR local control plane' }));
  app.get('/api/status', (_req, res) => res.json(status()));
  app.get('/api/community-profile',(_req,res)=>res.json(communityProfile));
  app.post('/api/community-profile',async(req,res)=>{try{
    const raw=req.body||{},phone=String(raw.phone||'').replace(/[\s().-]/g,'');
    if(!/^\+[1-9]\d{7,14}$/.test(phone))return res.status(400).json({message:'WhatsApp obrigatório com +DDI, DDD e número.'});
    const endpoint=String(raw.endpoint||'').replace(/\/$/,'');
    if(endpoint&&!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(endpoint)&&!/^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}$/.test(endpoint))return res.status(400).json({message:'O servidor da comunidade deve usar HTTPS.'});
    const next={phone,endpoint,sharePhone:raw.sharePhone===true,noticeAccepted:raw.noticeAccepted===true,registrationId:String(raw.registrationId||'').slice(0,80),fingerprint:String(raw.fingerprint||'').slice(0,200),token:String(raw.token||'').slice(0,100),account:raw.account&&typeof raw.account==='object'?raw.account:null};
    await saveWindowsSecret(communityFile,JSON.stringify(next));communityProfile=next;return res.json({saved:true});
  }catch{return res.status(500).json({message:'Não foi possível guardar o perfil da comunidade com proteção do Windows.'});}});
  app.get('/api/system-log',(_req,res)=>res.json({entries:systemLog}));
  app.delete('/api/system-log',(_req,res)=>{systemLog.length=0;res.json({ok:true});});
  app.post('/api/usage/reset',(_req,res)=>{gateway.resetUsage();res.json(gateway.usageSnapshot());});
  app.get('/api/aprs',(_req,res)=>res.json(aprs.snapshot()));
  app.post('/api/aprs/connect',async(req,res)=>{try{return res.json(await aprs.connect(req.body?.config||{},String(req.body?.passcode||'-1')));}catch(error){return res.status(400).json({message:(error as Error).message});}});
  app.post('/api/aprs/disconnect',(_req,res)=>{aprs.disconnect();res.json(aprs.snapshot());});
  app.post('/api/aprs/message',(req,res)=>{try{return res.json(aprs.sendMessage(String(req.body?.to||''),String(req.body?.text||'')));}catch(error){return res.status(409).json({message:(error as Error).message});}});
  app.post('/api/aprs/position',(req,res)=>{try{aprs.position(Number(req.body?.latitude),Number(req.body?.longitude));return res.json(aprs.snapshot());}catch(error){return res.status(400).json({message:(error as Error).message});}});
  app.post('/api/aprs/beacon',(_req,res)=>{try{aprs.beacon();return res.json(aprs.snapshot());}catch(error){return res.status(409).json({message:(error as Error).message});}});
  app.get('/api/spp',async(_req,res)=>res.json(await serialPtt.devices()));
  app.post('/api/spp',(req,res)=>{try{res.json(req.body?.action==='cancelLearn'?serialPtt.cancelLearn():serialPtt.learn(String(req.body?.binding||'')));}catch(error){res.status(409).json({message:(error as Error).message});}});
  app.post('/api/voice-target',(req,res)=>{
    if(gateway.status().pttArmed||talkgroupBurstPending)return res.status(409).json({message:'Termine a transmissão ou a troca de TG.'});
    const id=Number(req.body?.destinationId),privateCall=req.body?.callType==='private';
    if(privateCall&&(!Number.isInteger(id)||id<1||id>0xffffff||id===Number(settings.dmrId)))return res.status(400).json({message:'Radio ID de destino inválido.'});
    voiceTarget=privateCall?{id,callType:'private'}:null;
    gateway.selectReception(privateCall?id:Number(settings.selectedTalkgroupId),privateCall?'private':'group');
    if(audioClient)try{audioClient.send(AudioSidecarMessage.clearRx);}catch{}
    log(privateCall?`Destino privado preparado: Radio ID ${id}. Transmite apenas com PTT.`:`Destino de grupo restaurado: TG ${settings.selectedTalkgroupId}.`);
    broadcast('status',status());return res.json({target:voiceTarget||{id:settings.selectedTalkgroupId,callType:'group'}});
  });
  app.get('/api/settings', (_req, res) => res.json({
    ...settings, profileId: activeProfileId, profileName: profiles.find((profile) => profile.id === activeProfileId)?.name ?? 'Perfil',
    passwordConfigured: Boolean(hotspotPassword), passwordStoreError
  }));
  app.get('/api/profiles', async (_req, res) => res.json({ activeProfileId, profiles: await profileMetadata() }));
  app.post('/api/profiles', async (req, res, next) => {
    try {
      if (gateway.status().pttArmed) return res.status(409).json({ error: 'Desarme o PTT antes de criar um perfil.' });
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 40) : '';
      if (!name) return res.status(400).json({ error: 'Informe um nome para o perfil.' });
      const id = randomUUID().replace(/-/g, '').slice(0, 24);
      const profileSettings = cleanSettings(req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : settings);
      const submitted = typeof req.body?.hotspotPassword === 'string' ? req.body.hotspotPassword : hotspotPassword ?? '';
      if (submitted && (submitted.length > 20 || /[^\x21-\x7e]/.test(submitted)))
        return res.status(400).json({ error: 'A Hotspot Security Password deve ter até 20 caracteres imprimíveis, sem espaços.' });
      if (submitted) {
        await saveWindowsSecret(profileSecretFile(id), submitted);
        profilePasswordsConfigured.add(id);
      }
      connectionWanted = false; clearTotTimers(); clearReconnect(true);
      if (gateway.status().state !== 'disconnected') await gateway.disconnect();
      profiles.push({ id, name, settings: profileSettings });
      activeProfileId = id;
      settings = { ...profileSettings };
      hotspotPassword = submitted || undefined;
      passwordStoreError = false;
      await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
      await persistProfiles();
      broadcast('settings', { ...settings, profileId: activeProfileId, profileName: name, passwordConfigured: Boolean(hotspotPassword), passwordStoreError });
      return res.status(201).json({ activeProfileId, profiles: await profileMetadata(), settings: { ...settings, profileId: activeProfileId, profileName: name, passwordConfigured: Boolean(hotspotPassword), passwordStoreError } });
    } catch (error) { return next(error); }
  });
  app.post('/api/profiles/:id/activate', async (req, res, next) => {
    try {
      if (gateway.status().pttArmed) return res.status(409).json({ error: 'Desarme o PTT antes de trocar de perfil.' });
      const profile = profiles.find((item) => item.id === req.params.id);
      if (!profile) return res.status(404).json({ error: 'Perfil não encontrado.' });
      connectionWanted = false;
      clearTotTimers();
      clearReconnect(true);
      if (gateway.status().state !== 'disconnected') await gateway.disconnect();
      activeProfileId = profile.id;
      settings = { ...profile.settings };
      passwordStoreError = false;
      try {
        hotspotPassword = await loadWindowsSecret(profileSecretFile(profile.id)) ??
          (profile.id === 'default' ? await loadWindowsSecret(passwordFile) : undefined);
        if (hotspotPassword) profilePasswordsConfigured.add(profile.id);
      } catch (error) { hotspotPassword = undefined; passwordStoreError = true; console.warn('ZapDMR: senha do perfil não foi lida:', (error as Error).message); }
      await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
      await persistProfiles();
      broadcast('settings', { ...settings, profileId: activeProfileId, profileName: profile.name, passwordConfigured: Boolean(hotspotPassword), passwordStoreError });
      broadcast('status', status());
      return res.json({ activeProfileId, profiles: await profileMetadata(), settings: { ...settings, profileId: activeProfileId, profileName: profile.name, passwordConfigured: Boolean(hotspotPassword), passwordStoreError } });
    } catch (error) { return next(error); }
  });
  app.delete('/api/profiles/:id', async (req, res, next) => {
    try {
      if (profiles.length <= 1) return res.status(409).json({ error: 'O ZapDMR precisa manter pelo menos um perfil.' });
      if (gateway.status().pttArmed) return res.status(409).json({ error: 'Desarme o PTT antes de eliminar um perfil.' });
      const index = profiles.findIndex((item) => item.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Perfil não encontrado.' });
      const deletingActive = profiles[index].id === activeProfileId;
      if (deletingActive) {
        connectionWanted = false; clearTotTimers(); clearReconnect(true);
        if (gateway.status().state !== 'disconnected') await gateway.disconnect();
      }
      const [removed] = profiles.splice(index, 1);
      await fs.rm(profileSecretFile(removed.id), { force: true });
      profilePasswordsConfigured.delete(removed.id);
      if (deletingActive) {
        const next = profiles[0]; activeProfileId = next.id; settings = { ...next.settings };
        try { hotspotPassword = await loadWindowsSecret(profileSecretFile(next.id)) ?? (next.id === 'default' ? await loadWindowsSecret(passwordFile) : undefined); }
        catch { hotspotPassword = undefined; passwordStoreError = true; }
        await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
        broadcast('settings', { ...settings, profileId: activeProfileId, profileName: next.name, passwordConfigured: Boolean(hotspotPassword), passwordStoreError });
        broadcast('status', status());
      }
      await persistProfiles();
      return res.json({ activeProfileId, profiles: await profileMetadata() });
    } catch (error) { return next(error); }
  });
  app.get('/api/talkgroups', async (_req, res, next) => {
    try {
      const base = JSON.parse(await fs.readFile(talkgroupsFile, 'utf8')) as Talkgroup[];
      const baseIds = new Set(base.map((group) => group.id));
      res.json([...base, ...customTalkgroups.filter((group) => !baseIds.has(group.id)).map((group) => ({ ...group, custom: true }))]);
    }
    catch (error) { next(error); }
  });
  app.get('/api/talkgroups/activity', (_req, res) => res.json(gateway.talkgroupActivitySnapshot()));
  let databaseUpdating = false;
  app.post('/api/dmr-id-database/update', async (_req, res, next) => {
    if (databaseUpdating) return res.status(409).json({ error: 'Atualização já em curso.' });
    databaseUpdating = true;
    try {
      const response = await fetch('https://radioid.net/static/user.csv', { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'ZapDMR/1.2 amateur-radio offline ID lookup' } });
      if (!response.ok || !response.body) throw new Error('RadioID indisponível (HTTP ' + response.status + ').');
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 40 * 1024 * 1024) throw new Error('Base excede 40 MB.'); chunks.push(Buffer.from(chunk)); }
      const records = parseDmrIdCsv(Buffer.concat(chunks).toString('utf8'));
      const updatedAt = new Date().toISOString();
      await fs.writeFile(dmrIdDatabaseFile + '.tmp', JSON.stringify({ updatedAt, records }), { mode: 0o600 });
      await fs.rename(dmrIdDatabaseFile + '.tmp', dmrIdDatabaseFile);
      dmrIdRecords = records; directoryByCall = null; dmrIdDatabaseUpdatedAt = updatedAt;
      for (const item of [...participants.values()]) rememberParticipant(item);
      broadcast('status', status()); return res.json(databaseMetadata());
    } catch (error) { return next(error); } finally { databaseUpdating = false; }
  });
  const directoryRemoteCache=new Map<string,{at:number;record?:DmrIdRecord}>();
  app.post('/api/dmr-id-database/lookup', async (req,res)=>{
    const ids:string[]=Array.isArray(req.body?.ids)?[...new Set<string>(req.body.ids.map(String).map((id:string)=>id.toUpperCase()).filter((id:string)=>/^[A-Z0-9/]{2,16}$/.test(id)))].slice(0,100):[];
    if(!directoryByCall)directoryByCall=new Map(Object.values(dmrIdRecords).map(record=>[record.callsign.toUpperCase(),record]));
    const find=(id:string)=>dmrIdRecords[id]||directoryByCall!.get(id)||directoryRemoteCache.get(id)?.record;
    const missing=ids.filter(id=>!find(id)&&Date.now()-(directoryRemoteCache.get(id)?.at||0)>3600000).slice(0,4);
    await Promise.all(missing.map(async id=>{
      directoryRemoteCache.set(id,{at:Date.now()});
      try{
        const response=await fetch('https://radioid.net/api/dmr/user/?'+(/^\d+$/.test(id)?'id=':'callsign=')+encodeURIComponent(id),{signal:AbortSignal.timeout(5000)});
        if(!response.ok)return;
        const data=await response.json() as {results?:Record<string,unknown>[]};const row=data.results?.find(row=>String(row.id)===id||String(row.callsign).toUpperCase()===id);
        if(!row||!/^\d{1,8}$/.test(String(row.id)))return;
        const record:DmrIdRecord={id:String(row.id),callsign:String(row.callsign||''),name:String(row.name||row.fname||''),city:String(row.city||''),state:String(row.state||''),country:String(row.country||'')};
        directoryRemoteCache.set(record.id,{at:Date.now(),record});directoryRemoteCache.set(record.callsign.toUpperCase(),{at:Date.now(),record});
      }catch{/* Offline directory remains available. */}
    }));
    return res.json({records:[...new Map(ids.map(find).filter((record):record is DmrIdRecord=>Boolean(record)).map(record=>[record.id,record])).values()]});
  });
  app.get('/api/dmr-id-database', (_req, res) => res.json(databaseMetadata()));
  app.post('/api/dmr-id-database/import', async (req, res, next) => {
    try {
      if (typeof req.body?.csv !== 'string' || req.body.csv.length > 25 * 1024 * 1024)
        return res.status(400).json({ error: 'Selecione um CSV de até 25 MB.' });
      const records = parseDmrIdCsv(req.body.csv);
      const updatedAt = new Date().toISOString();
      const database = { updatedAt, records };
      const temporaryFile = `${dmrIdDatabaseFile}.tmp`;
      await fs.writeFile(temporaryFile, JSON.stringify(database), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporaryFile, dmrIdDatabaseFile);
      dmrIdRecords = records;
      dmrIdDatabaseUpdatedAt = updatedAt;
      for (const item of [...participants.values()]) rememberParticipant(item);
      broadcast('status', status());
      return res.json(databaseMetadata());
    } catch (error) { return next(error); }
  });
  app.delete('/api/dmr-id-database', async (_req, res, next) => {
    if (databaseUpdating) return res.status(409).json({ error: 'Aguarde a atualização em curso.' });
    try {
      dmrIdRecords = {}; directoryByCall = null;
      dmrIdDatabaseUpdatedAt = null;
      await fs.rm(dmrIdDatabaseFile, { force: true });
      broadcast('status', status());
      return res.json(databaseMetadata());
    } catch (error) { return next(error); }
  });
  app.get('/api/backup', async (_req, res, next) => {
    try {
      const profilesWithSecrets = await Promise.all(profiles.map(async (profile) => ({
        ...profile,
        protectedPassword: await fs.readFile(profileSecretFile(profile.id), 'utf8').then((value) => value.trim()).catch(async () =>
          profile.id === 'default' ? await fs.readFile(passwordFile, 'utf8').then((value) => value.trim()).catch(() => undefined) : undefined)
      })));
      res.setHeader('Content-Disposition', `attachment; filename="ZapDMR-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      return res.json({
        format: 'ZapDMR-backup', version: 2, createdAt: new Date().toISOString(),
        settings, customTalkgroups, dmrIdDatabase: { updatedAt: dmrIdDatabaseUpdatedAt, records: dmrIdRecords },
        activeProfileId, profiles: profilesWithSecrets
      });
    } catch (error) { return next(error); }
  });
  app.post('/api/backup', async (req, res, next) => {
    try {
      const backup = req.body as { format?: unknown; version?: unknown; settings?: Partial<AppSettings>; customTalkgroups?: unknown; dmrIdDatabase?: unknown; protectedPassword?: unknown; activeProfileId?: unknown; profiles?: unknown };
      if (backup?.format !== 'ZapDMR-backup' || ![1, 2].includes(Number(backup.version)) || !backup.settings || !Array.isArray(backup.customTalkgroups))
        return res.status(400).json({ error: 'O arquivo não é um backup ZapDMR válido.' });
      if (gateway.status().pttArmed)
        return res.status(409).json({ error: 'Desarme o PTT antes de restaurar um backup.' });
      const restoredSettings = cleanSettings(backup.settings);
      const restoredGroups = backup.customTalkgroups.filter((item): item is Talkgroup => {
        if (!item || typeof item !== 'object') return false;
        const group = item as Partial<Talkgroup>;
        return Number.isInteger(group.id) && Number(group.id) > 0 && Number(group.id) <= 0xffffff &&
          typeof group.name === 'string' && group.name.trim().length > 0 && (group.slot === 1 || group.slot === 2) &&
          typeof group.category === 'string' && CUSTOM_TALKGROUP_CATEGORIES.has(group.category) && group.kind === 'group';
      }).map((group) => ({ ...group, name: group.name.trim().slice(0, 60), custom: true }));
      const rawDb = backup.dmrIdDatabase as { records?: unknown; updatedAt?: unknown } | undefined;
      const restoredRecords = cleanDmrIdRecords(rawDb?.records);
      const restoredProfiles: SavedProfile[] = Array.isArray(backup.profiles) ? backup.profiles.flatMap((raw): SavedProfile[] => {
        if (!raw || typeof raw !== 'object') return [];
        const profile = raw as Partial<SavedProfile> & { protectedPassword?: unknown };
        if (typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(profile.id) || !profile.settings || typeof profile.settings !== 'object') return [];
        return [{ id: profile.id, name: typeof profile.name === 'string' ? profile.name.trim().slice(0, 40) || 'Perfil' : 'Perfil', settings: cleanSettings(profile.settings) }];
      }) : [{ id: 'default', name: restoredSettings.callsign || 'Perfil principal', settings: restoredSettings }];
      if (!restoredProfiles.length) return res.status(400).json({ error: 'O backup não contém perfis válidos.' });
      const restoredActiveProfileId = restoredProfiles.some((profile) => profile.id === backup.activeProfileId)
        ? String(backup.activeProfileId) : restoredProfiles[0].id;
      const profileSecretMap = new Map<string, string>();
      if (Array.isArray(backup.profiles)) for (const raw of backup.profiles) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as { id?: unknown; protectedPassword?: unknown };
        if (typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) &&
            typeof item.protectedPassword === 'string' && /^dpapi-(?:user|machine):[A-Za-z0-9+/=]+$/.test(item.protectedPassword))
          profileSecretMap.set(item.id, item.protectedPassword);
      }
      const legacyProtectedPassword = typeof backup.protectedPassword === 'string' && /^dpapi-(?:user|machine):[A-Za-z0-9+/=]+$/.test(backup.protectedPassword)
        ? backup.protectedPassword : undefined;
      await fs.writeFile(settingsFile, JSON.stringify(restoredSettings, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.writeFile(customTalkgroupsFile, JSON.stringify(restoredGroups, null, 2), { encoding: 'utf8', mode: 0o600 });
      const restoredUpdatedAt = typeof rawDb?.updatedAt === 'string' ? rawDb.updatedAt : null;
      if (Object.keys(restoredRecords).length) {
        await fs.writeFile(dmrIdDatabaseFile, JSON.stringify({ updatedAt: restoredUpdatedAt, records: restoredRecords }), { encoding: 'utf8', mode: 0o600 });
      } else await fs.rm(dmrIdDatabaseFile, { force: true });
      await fs.mkdir(profileSecretsDir, { recursive: true });
      for (const entry of await fs.readdir(profileSecretsDir).catch(() => []))
        if (entry.endsWith('.dpapi')) await fs.rm(path.join(profileSecretsDir, entry), { force: true });
      for (const [id, encrypted] of profileSecretMap) await fs.writeFile(profileSecretFile(id), `${encrypted}\n`, { encoding: 'utf8', mode: 0o600 });
      if (legacyProtectedPassword && !profileSecretMap.has('default')) await fs.writeFile(passwordFile, `${legacyProtectedPassword}\n`, { encoding: 'utf8', mode: 0o600 });
      else if (!profileSecretMap.has('default')) await fs.rm(passwordFile, { force: true });
      profiles = restoredProfiles;
      activeProfileId = restoredActiveProfileId;
      const restoredActiveProfile = profiles.find((profile) => profile.id === activeProfileId)!;
      settings = { ...restoredActiveProfile.settings };
      await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
      customTalkgroups = restoredGroups;
      dmrIdRecords = restoredRecords;
      dmrIdDatabaseUpdatedAt = restoredUpdatedAt;
      profilePasswordsConfigured.clear();
      for (const id of profileSecretMap.keys()) profilePasswordsConfigured.add(id);
      try { hotspotPassword = await loadWindowsSecret(profileSecretFile(activeProfileId)) ?? (activeProfileId === 'default' ? await loadWindowsSecret(passwordFile) : undefined); passwordStoreError = false; }
      catch { hotspotPassword = undefined; passwordStoreError = true; }
      await persistProfiles();
      broadcast('settings', { ...settings, profileId: activeProfileId, profileName: restoredActiveProfile.name, passwordConfigured: Boolean(hotspotPassword), passwordStoreError });
      broadcast('status', status());
      return res.json({ restored: true, ...databaseMetadata(), passwordConfigured: Boolean(hotspotPassword) });
    } catch (error) { return next(error); }
  });
  app.post('/api/talkgroups', async (req, res, next) => {
    try {
      const raw = req.body ?? {};
      const idText = typeof raw.id === 'number' || typeof raw.id === 'string' ? String(raw.id).trim() : '';
      const id = /^\d{1,8}$/.test(idText) ? Number(idText) : NaN;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const slot = Number(raw.slot);
      const category = typeof raw.category === 'string' ? raw.category : '';
      if (!Number.isInteger(id) || id < 1 || id > 0xffffff)
        return res.status(400).json({ error: 'O número da TG deve conter apenas algarismos e estar entre 1 e 16777215.' });
      if (!name || name.length > 60)
        return res.status(400).json({ error: 'Informe um nome para a TG com até 60 caracteres.' });
      if (slot !== 1 && slot !== 2)
        return res.status(400).json({ error: 'Selecione TS 1 ou TS 2.' });
      if (!CUSTOM_TALKGROUP_CATEGORIES.has(category))
        return res.status(400).json({ error: 'Selecione uma categoria válida.' });
      const base = JSON.parse(await fs.readFile(talkgroupsFile, 'utf8')) as Talkgroup[];
      if (base.some((group) => group.id === id) || customTalkgroups.some((group) => group.id === id))
        return res.status(409).json({ error: `A TG ${id} já existe no catálogo.` });
      const previous = customTalkgroups;
      customTalkgroups = [...customTalkgroups, { id, name, slot: slot as 1 | 2, category, kind: 'group', custom: true }];
      try {
        const temporaryFile = `${customTalkgroupsFile}.tmp`;
        await fs.writeFile(temporaryFile, JSON.stringify(customTalkgroups, null, 2), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryFile, customTalkgroupsFile);
      } catch (error) { customTalkgroups = previous; throw error; }
      const baseIds = new Set(base.map((group) => group.id));
      return res.status(201).json([...base, ...customTalkgroups.filter((group) => !baseIds.has(group.id)).map((group) => ({ ...group, custom: true }))]);
    } catch (error) { return next(error); }
  });
  app.delete('/api/talkgroups/:id', async (req, res, next) => {
    try {
      const id = /^\d{1,8}$/.test(req.params.id) ? Number(req.params.id) : NaN;
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Número de TG inválido.' });
      const index = customTalkgroups.findIndex((group) => group.id === id);
      if (index < 0) return res.status(404).json({ error: 'Apenas TGs cadastradas pelo utilizador podem ser removidas.' });
      const previous = customTalkgroups;
      customTalkgroups = customTalkgroups.filter((group) => group.id !== id);
      try {
        const temporaryFile = `${customTalkgroupsFile}.tmp`;
        await fs.writeFile(temporaryFile, JSON.stringify(customTalkgroups, null, 2), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryFile, customTalkgroupsFile);
      } catch (error) { customTalkgroups = previous; throw error; }
      return res.json({ removed: id });
    } catch (error) { return next(error); }
  });
  app.post('/api/settings', async (req, res, next) => {
    try {
      const nextSettings = cleanSettings(req.body as Partial<AppSettings>);
      if (gateway.status().pttArmed && !gateway.status().talkgroupBurstActive && nextSettings.selectedTalkgroupId !== settings.selectedTalkgroupId)
        return res.status(409).json({ error: 'Desarme o PTT manualmente antes de trocar de TalkGroup.' });
      if (nextSettings.dmrId && !/^\d{7}$/.test(nextSettings.dmrId))
        return res.status(400).json({ error: 'O Radio ID base deve conter 7 algarismos.' });
      if (!/^\d{2}$/.test(nextSettings.essid))
        return res.status(400).json({ error: 'O ESSID deve conter dois algarismos, de 00 a 99.' });
      if (nextSettings.masterHost && !/^[a-zA-Z0-9.-]+$/.test(nextSettings.masterHost))
        return res.status(400).json({ error: 'Informe apenas o nome DNS ou endereço do master.' });
      if (!Number.isInteger(req.body?.masterPort) || req.body.masterPort < 1 || req.body.masterPort > 65535)
        return res.status(400).json({ error: 'A porta do servidor deve ser um número entre 1 e 65535.' });
      if ((typeof req.body?.latitude === 'string' && req.body.latitude.trim() && !nextSettings.latitude) ||
          (typeof req.body?.longitude === 'string' && req.body.longitude.trim() && !nextSettings.longitude))
        return res.status(400).json({ error: 'Latitude ou longitude fora dos limites permitidos.' });
      const submitted = typeof req.body?.hotspotPassword === 'string' ? req.body.hotspotPassword : '';
      if (submitted && (submitted.length > 20 || /[^\x21-\x7e]/.test(submitted)))
        return res.status(400).json({ error: 'A Hotspot Security Password deve ter até 20 caracteres imprimíveis, sem espaços.' });
      if (submitted) {
        await saveWindowsSecret(profileSecretFile(activeProfileId), submitted);
        profilePasswordsConfigured.add(activeProfileId);
        hotspotPassword = submitted;
        passwordStoreError = false;
      }
      const previousSettings = settings;
      const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
      const previousProfileName = activeProfile?.name;
      const profileName = typeof req.body?.profileName === 'string' ? req.body.profileName.trim().slice(0, 40) : '';
      settings = nextSettings;
      serialPtt.configure(settings.operation);
      if(nextSettings.selectedTalkgroupId!==previousSettings.selectedTalkgroupId){
        rxTargetTalkgroupId=Number(nextSettings.selectedTalkgroupId);
        if(audioClient&&audioSidecar.state==='ready')try{audioClient.send(AudioSidecarMessage.clearRx);}catch{}
      }
      if (activeProfile) {
        activeProfile.settings = { ...nextSettings };
        if (profileName) activeProfile.name = profileName;
      }
      try {
        await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
        await persistProfiles();
      } catch (error) {
        settings = previousSettings;
        if (activeProfile) { activeProfile.settings = previousSettings; activeProfile.name = previousProfileName ?? activeProfile.name; }
        throw error;
      }
      if (audioClient && audioSidecar.state === 'ready') {
        try {
          audioClient.send(AudioSidecarMessage.setTxGain, Buffer.from([settings.txGainPercent]));
          audioClient.send(AudioSidecarMessage.setRxVolume, Buffer.from([settings.rxVolumePercent]));
        } catch (error) { console.warn('ZapDMRAudio: não foi possível aplicar ganho/volume:', (error as Error).message); }
      }
      if (gateway.status().pttArmed) armTotTimers(totStartedAt ?? Date.now());
      if (!settings.autoReconnect) clearReconnect(true);
      else {
        const gatewayStatus = gateway.status();
        if (connectionWanted && gatewayStatus.state === 'error' && typeof gatewayStatus.errorCode === 'string' &&
            retryableGatewayErrors.has(gatewayStatus.errorCode))
          scheduleReconnect(gatewayStatus.message || 'A sessão caiu.');
      }
      broadcast('settings', { ...settings, profileId: activeProfileId, profileName: activeProfile?.name ?? 'Perfil', passwordConfigured: Boolean(hotspotPassword), passwordStoreError });
      broadcast('status', status());
      return res.json({ ...settings, profileId: activeProfileId, profileName: activeProfile?.name ?? 'Perfil', passwordConfigured: Boolean(hotspotPassword), passwordStoreError });
    } catch (error) { return next(error); }
  });
  app.post('/api/connect', async (_req, res) => {
    if(!/^\+[1-9]\d{7,14}$/.test(String(communityProfile.phone||'')))return res.status(409).json({accepted:false,message:'Complete o campo WhatsApp obrigatório no Perfil antes de ligar.'});
    connectionWanted = true;
    clearReconnect(true);
    const result = await attemptConnection(false);
    return res.status(resultStatus(result)).json(result);
  });
  app.post('/api/disconnect', async (_req, res) => {
    if(gateway.status().pttArmed)return res.status(409).json({message:'Termine a transmissão antes de desconectar.'});
    connectionWanted = false;
    clearTotTimers();
    clearReconnect(true);
    const result = await gateway.disconnect();
    broadcast('status', status());
    return res.json(result);
  });
  app.post('/api/ptt', async (req, res) => {
    const active = req.body?.active === true;
    const callType=voiceTarget?.callType||'group';
    const talkgroupId = voiceTarget?.id||Number(req.body?.talkgroupId ?? settings.selectedTalkgroupId);
    const slot = Number(req.body?.slot ?? settings.defaultSlot ?? 1);
    if (active && audioTestRunning) return res.status(409).json({accepted:false,message:'Aguarde o teste local de áudio terminar.'});
    if (active && (disconnectTalkgroupPending || talkgroupBurstPending))
      return res.status(409).json({ accepted: false, code: 'TRANSMISSION_BUSY', message: 'Aguarde o pedido de desconexão TG 4000 terminar.' });
    if (!active) {
      clearTotTimers();
      try {
        if (audioClient) {
          const payload = Buffer.alloc(5);
          payload[0] = 0;
          payload.writeUInt32LE(Number(gateway.status().talkgroupId ?? talkgroupId), 1);
          audioClient.send(AudioSidecarMessage.setPtt, payload);
        }
      } catch (error) { console.warn('ZapDMRAudio PTT release:', (error as Error).message); }
      const result = await gateway.setPtt(false, talkgroupId);
      return res.status(resultStatus(result)).json(result);
    }

    const result = await gateway.setPtt(true, talkgroupId, slot as 1 | 2,callType);
    if (!result.accepted) return res.status(resultStatus(result)).json(result);
    try {
      if (!audioClient) throw new Error('Sidecar de áudio não conectado.');
      const payload = Buffer.alloc(5);
      payload[0] = 1;
      payload.writeUInt32LE(talkgroupId, 1);
      audioClient.send(AudioSidecarMessage.setPtt, payload);
      armTotTimers();
      return res.status(200).json(result);
    } catch (error) {
      await gateway.setPtt(false, talkgroupId);
      return res.status(503).json({ accepted: false, code: 'AUDIO_PIPE_FAILED', message: `Falha ao iniciar PTT de áudio: ${(error as Error).message}` });
    }
  });
  app.post('/api/audio-levels', async (req, res, next) => {
    const tx=Number(req.body?.txGainPercent),rx=Number(req.body?.rxVolumePercent);
    if(!Number.isInteger(tx)||tx<0||tx>200||!Number.isInteger(rx)||rx<0||rx>200)return res.status(400).json({error:'Ganho e volume devem estar entre 0 e 200%.'});
    try{
      settings={...settings,txGainPercent:tx,rxVolumePercent:rx};
      const profile=profiles.find(item=>item.id===activeProfileId);if(profile)profile.settings={...settings};
      let applied=false;
      if(audioClient&&audioSidecar.state==='ready'){audioClient.send(AudioSidecarMessage.setTxGain,Buffer.from([tx]));audioClient.send(AudioSidecarMessage.setRxVolume,Buffer.from([rx]));applied=true;}
      await fs.writeFile(settingsFile,JSON.stringify(settings,null,2),{mode:0o600});await persistProfiles();
      return res.json({applied,txGainPercent:tx,rxVolumePercent:rx,message:applied?'Ganho e volume aplicados no motor ativo.':'Valores guardados; aguardando o auxiliar de áudio.'});
    }catch(error){return next(error);}
  });
  app.post('/api/audio-test', async (req, res) => {
    const client=audioClient;
    if(!client||audioSidecar.state!=='ready')return res.status(503).json({accepted:false,message:'O auxiliar de áudio não está pronto. Confira o estado de áudio e o dispositivo de saída.'});
    if(gateway.status().pttArmed||audioTestRunning||talkgroupBurstPending)return res.status(409).json({accepted:false,message:'Termine o PTT ou o teste em curso antes de testar o áudio.'});
    audioTestRunning=true;
    try{
      await new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);client.off('status',onStatus);client.off('sidecarError',onError);client.off('pipeClose',onClose);};
        const onStatus=(message:string)=>{if(message.includes('AUDIO_TEST_COMPLETE')){cleanup();resolve();}};
        const onError=(error:{message:string})=>{cleanup();reject(new Error(error.message));};
        const onClose=()=>{cleanup();reject(new Error('O auxiliar de áudio desligou durante o teste.'));};
        const timer=setTimeout(()=>{cleanup();reject(new Error('O auxiliar não concluiu o teste em 20 segundos.'));},20000);
        client.on('status',onStatus);client.on('sidecarError',onError);client.on('pipeClose',onClose);
        try{client.send(AudioSidecarMessage.audioTest,req.body?.microphone?Buffer.from([1]):undefined);}catch(error){cleanup();reject(error);}
      });
      return res.json({accepted:true,message:req.body?.microphone?'Microfone gravado e reproduzido pelo vocoder, sem transmitir. Compare os ganhos.':'Tom codificado e descodificado pelo vocoder e enviado à saída local. Confirme se ouviu.'});
    }catch(error){return res.status(503).json({accepted:false,message:'Teste local: '+(error as Error).message});}
    finally{audioTestRunning=false;}
  });
  app.post('/api/link-talkgroup', async(req,res)=>{
    const id=Number(req.body?.talkgroupId);
    if(!Number.isInteger(id)||id<1||id>0xffffff)return res.status(400).json({message:'TG inválida.'});
    if(gateway.status().pttArmed||audioTestRunning||disconnectTalkgroupPending)return res.status(409).json({message:'Termine PTT ou teste antes de trocar TG.'});
    voiceTarget=null;rxTargetTalkgroupId=id;++linkRevision;gateway.selectReception(id);
    if(audioClient)try{audioClient.send(AudioSidecarMessage.clearRx);}catch{}
    log(`TG ${id}: ${gateway.status().protocol==='odtp'?'inscrição ODTP solicitada':'filtro HBP local'}; nenhum áudio de ativação enviado.`);
    broadcast('status',status());
    return res.json({accepted:true,code:gateway.status().protocol==='odtp'?'TG_SUBSCRIPTION_REQUESTED':'TG_FILTER_ONLY',reception:gateway.status().reception,message:gateway.status().reception.message});
  });
  app.post('/api/disconnect-talkgroup', async (_req, res) => {
    const currentGatewayStatus = gateway.status();
    if(currentGatewayStatus.connected&&currentGatewayStatus.protocol==='odtp'){if(currentGatewayStatus.pttArmed)return res.status(409).json({message:'Termine o PTT antes de cancelar a inscrição.'});gateway.selectReception(0);return res.json({accepted:true,code:'ODTP_UNSUBSCRIBE_REQUESTED',message:'Cancelamento de inscrição ODTP solicitado, sem TG 4000.'});}
    if (!currentGatewayStatus.connected)
      return res.status(409).json({ accepted: false, code: 'NOT_CONNECTED', message: 'Ligue primeiro ao master BrandMeister.' });
    if (currentGatewayStatus.pttArmed || currentGatewayStatus.disconnectingTalkgroup || currentGatewayStatus.talkgroupBurstActive)
      return res.status(409).json({ accepted: false, code: 'TRANSMISSION_BUSY', message: 'Termine a transmissão atual antes de desconectar a TG dinâmica.' });
    if (talkgroupBurstPending)
      return res.status(409).json({ accepted: false, code: 'TRANSMISSION_BUSY', message: 'Já existe um pedido TG 4000 em andamento.' });
    if (!audioClient || audioSidecar.state !== 'ready')
      return res.status(503).json({ accepted: false, code: 'AUDIO_UNAVAILABLE', message: 'O vocoder/servidor de áudio não está pronto.' });
    const disconnectGroup = await (async () => {
      try {
        const base = JSON.parse(await fs.readFile(talkgroupsFile, 'utf8')) as Talkgroup[];
        return [...base, ...customTalkgroups].find((group) => group.id === Number(settings.selectedTalkgroupId));
      } catch { return undefined; }
    })();
    if (talkgroupBurstPending)
      return res.status(409).json({ accepted: false, code: 'TRANSMISSION_BUSY', message: 'Já existe um pedido TG 4000 em andamento.' });
    const slot = disconnectGroup?.slot === 2 ? 2 : 1;
    disconnectTalkgroupPending = true;
    talkgroupBurstPending = true;
    talkgroupBurstPurpose = 'disconnect';
    talkgroupBurstTalkgroupId = 4000;
    broadcast('status', status());
    try {
      const codewords = await requestSilenceCodewords(audioClient, audioLaunchGeneration);
      const result = await gateway.sendDisconnectTalkgroup(slot, codewords);
      return res.status(resultStatus(result)).json(result);
    } catch (error) {
      return res.status(503).json({ accepted: false, code: 'SILENCE_VOCODER_FAILED', message: (error as Error).message });
    } finally {
      disconnectTalkgroupPending = false;
      talkgroupBurstPending = false;
      talkgroupBurstPurpose = null;
      talkgroupBurstTalkgroupId = null;
      broadcast('status', status());
    }
  });
  app.post('/api/ptt/frame', async (req, res) => {
    const encoded = req.body?.packetBase64;
    if (typeof encoded !== 'string' || encoded.length > 256 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      return res.status(400).json({ accepted: false, code: 'INVALID_BASE64', message: 'Envie packetBase64 em Base64.' });
    const packet = Buffer.from(encoded, 'base64');
    if (packet.toString('base64') !== encoded)
      return res.status(400).json({ accepted: false, code: 'INVALID_BASE64', message: 'O conteúdo Base64 não é canónico.' });
    const result = await gateway.sendDmrFrame(packet);
    return res.status(resultStatus(result)).json(result);
  });
  app.use(express.static(staticDir));
  app.use((req, res, next) => req.method === 'GET' && !req.path.startsWith('/api/')
    ? res.sendFile(path.join(staticDir, 'index.html')) : next());
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('ZapDMR request failed:', error);
    res.status(500).json({ error: 'Erro interno no serviço local.' });
  });

  wsServer.on('connection', (client, request) => {
    if (!isLoopback(request.socket.remoteAddress ?? '')) { client.close(4403, 'Local API only'); return; }
    client.send(JSON.stringify({ event: 'status', data: status() }));
  });
  try {
    lastHeard.start();
    const telemetry = await startUdpTelemetry(options.udpPort ?? 42040, (data) => {
      latestTelemetry = data; broadcast('telemetry', data);
    });
    udpSocket = telemetry.socket;
    udpPort = telemetry.port;
  } catch (error) { console.warn('UDP telemetry unavailable:', (error as Error).message); }

  if (audioSidecarExe) {
    if (process.platform !== 'win32') {
      audioSidecar = { state: 'unsupported-platform', status: 'ZapDMRAudio.exe requer Windows x64.' };
    } else {
      await launchAudioSidecar();
    }
  }

  const listenHost = process.env.ZAPDMR_BIND_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
  const envPort = Number(process.env.ZAPDMR_PORT);
  const listenPort = options.port ?? (Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : 0);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine local server address.');
  if (settings.autoConnectOnStartup) {
    const profileReady = /^[A-Z0-9/ -]{1,8}$/i.test(settings.callsign) &&
      /^\d{7}$/.test(settings.dmrId) && /^\d{2}$/.test(settings.essid) &&
      /^[a-zA-Z0-9.-]{1,180}$/.test(settings.masterHost) && Boolean(hotspotPassword);
    if (!profileReady || !/^\+[1-9]\d{7,14}$/.test(String(communityProfile.phone||''))) {
      connectionWanted = false;
      reconnectMessage = passwordStoreError
        ? 'Ligação automática não iniciada: não foi possível ler a senha protegida do Windows.'
        : 'Ligação automática não iniciada: complete o perfil, WhatsApp e Hotspot Security Password.';
      broadcast('status', status());
    } else {
      connectionWanted = true;
      void attemptConnection(false);
    }
  }
  return { url: `http://127.0.0.1:${address.port}`, port: address.port,
    close: async () => {
      shuttingDown = true;
      serialPtt.close();aprs.close();clearInterval(usageTimer);
      await fs.writeFile(path.join(userDataDir,'data-usage.json'),JSON.stringify(gateway.usageSnapshot()),{mode:0o600}).catch(()=>{});
      clearAudioMeter();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (audioRestartTimer) clearTimeout(audioRestartTimer);
      audioLaunchGeneration += 1;
      lastHeard.close();
      audioClient?.close(true);
      udpSocket?.close();
      if (mobilePttTalkgroupId !== undefined) await releaseMobilePtt();
      for (const client of mobileRelayServer.clients) client.close(1001, 'ZapDMR gateway is stopping');
      mobileRelayServer.close();
      await gateway.disconnect(false);
      wsServer.close();
      server.close();
      hotspotPassword = undefined;
    } };
}

if (require.main === module) {
  startServer({ port: Number(process.env.ZAPDMR_PORT ?? process.env.PORT ?? 4173), udpPort: Number(process.env.ZAPDMR_UDP_PORT ?? 42040) })
    .then(({ url }) => console.log(`ZapDMR local panel: ${url}`))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
