export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface ServerConfig {
  motd: string;
  port: number;
  maxPlayers: number;
  viewDistance: number;
  simulationDistance: number;
  gamemode: GameMode;
  difficulty: Difficulty;
  compressionThreshold: number;
  onlineMode: boolean;
  maxPacketSize: number;
  worldType: 'superflat' | 'void';
  spawnProtection: boolean;
}

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface MetricSample {
  timestamp: number;
  tps: number;
  mspt: number;
  ramMb: number;
  cpuPercent: number;
  players: number;
}

export interface ServerMetrics {
  status: ServerStatus;
  runtime: 'bun' | 'node';
  runtimeVersion: string;
  protocolVersion: number;
  minecraftVersion: string;
  port: number;
  uptimeMs: number;
  tps: number;
  mspt: number;
  ramUsedMb: number;
  ramTotalMb: number;
  cpuPercent: number;
  onlinePlayers: number;
  maxPlayers: number;
  totalPacketsIn: number;
  totalPacketsOut: number;
  droppedPackets: number;
  tickCount: number;
  workerActive: boolean;
  errorMessage?: string;
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'CHAT' | 'PLUGIN' | 'PROTOCOL';

export interface ConsoleLog {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
}

export type ProtocolState = 'HANDSHAKE' | 'STATUS' | 'LOGIN' | 'CONFIGURATION' | 'PLAY';

export interface PlayerInfo {
  id: string;
  entityId: number;
  username: string;
  uuid: string;
  ip: string;
  protocolVersion: number;
  clientVersionLabel: string;
  ping: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  gamemode: GameMode;
  isOp: boolean;
  isFlying: boolean;
  health: number;
  food: number;
  connectedAt: number;
  isBotProbe: boolean;
}

export interface BannedPlayer {
  username: string;
  uuid?: string;
  reason: string;
  bannedAt: number;
}

export type PacketDirection = 'INBOUND' | 'OUTBOUND' | 'SHIELD_DROP';

export interface PacketLogEntry {
  id: string;
  timestamp: number;
  direction: PacketDirection;
  connectionId: string;
  playerName?: string;
  state: ProtocolState;
  packetId: number;
  packetHexId: string;
  packetName: string;
  sizeBytes: number;
  compressed: boolean;
  summary: string;
  hexPreview: string;
  error?: string;
}

export interface PluginMetadata {
  id: string;
  filename: string;
  path: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  loadedAt: number;
  commands: string[];
  hooks: string[];
  error?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: number;
  extension?: string;
  children?: FileNode[];
}

export type WsServerEvent =
  | { type: 'init'; payload: { metrics: ServerMetrics; history: MetricSample[]; logs: ConsoleLog[]; players: PlayerInfo[]; packets: PacketLogEntry[]; plugins: PluginMetadata[]; config: ServerConfig; bans: BannedPlayer[] } }
  | { type: 'metrics'; payload: { metrics: ServerMetrics; sample: MetricSample } }
  | { type: 'log'; payload: ConsoleLog }
  | { type: 'packet'; payload: PacketLogEntry }
  | { type: 'players'; payload: PlayerInfo[] }
  | { type: 'bans'; payload: BannedPlayer[] }
  | { type: 'plugins'; payload: PluginMetadata[] }
  | { type: 'config'; payload: ServerConfig }
  | { type: 'toast'; payload: { level: 'success' | 'warn' | 'error'; title: string; message: string } };
