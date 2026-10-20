export type Theme = 'auto' | 'light' | 'dark';
export type ServerType = 'brandmeister' | 'other';
export const DEFAULT_HOTSPOT_FREQUENCY_HZ = '433500000';
export interface AppSettings {
  callsign: string;
  dmrId: string;
  essid: string;
  rxFrequencyHz: string;
  txFrequencyHz: string;
  masterHost: string;
  masterPort: number;
  serverType: ServerType;
  radioProtocol?: 'hbp' | 'odtp';
  staticTalkgroups: string;
  locationName: string;
  latitude: string;
  longitude: string;
  defaultSlot: 1 | 2;
  theme: Theme;
  autoConnectOnStartup: boolean;
  autoReconnect: boolean;
  maxReconnectAttempts?: number;
  autoOpenTalkgroup?: boolean;
  unlinkPreviousTalkgroup?: boolean;
  sendLocationOnConnect?: boolean;
  totEnabled?: boolean;
  console?: Record<string, unknown>;
  totLimitSeconds: number;
  totWarningSeconds: number;
  totVisualAlert: boolean;
  totSoundAlert: boolean;
  txGainPercent: number;
  rxVolumePercent: number;
  selectedTalkgroupId: number;
  favorites: number[];
  operation?: Record<string, unknown>;
}
export interface Talkgroup {
  id: number;
  slot: number | null;
  name: string;
  category: string;
  region?: string;
  kind: 'group' | 'private' | 'command';
  note?: string;
  custom?: boolean;
}
export const DEFAULT_SETTINGS: AppSettings = {
  callsign: '', dmrId: '', essid: '02', rxFrequencyHz: DEFAULT_HOTSPOT_FREQUENCY_HZ,
  txFrequencyHz: DEFAULT_HOTSPOT_FREQUENCY_HZ, masterHost: '', masterPort: 62031,
  serverType: 'brandmeister', staticTalkgroups: '', locationName: '', latitude: '', longitude: '', defaultSlot: 1, theme: 'auto',
  autoConnectOnStartup: false, autoReconnect: false,
  maxReconnectAttempts: 5, autoOpenTalkgroup: false, unlinkPreviousTalkgroup: false,
  sendLocationOnConnect: false, totEnabled: true,
  totLimitSeconds: 180, totWarningSeconds: 10, totVisualAlert: true, totSoundAlert: true,
  txGainPercent: 100, rxVolumePercent: 100,
  selectedTalkgroupId: 724, favorites: [724]
};
