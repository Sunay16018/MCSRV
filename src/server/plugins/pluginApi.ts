import type { GameMode, LogLevel, PlayerInfo, ProtocolState } from '../../shared/types.ts';

export interface PluginPlayer extends PlayerInfo {
  sendMessage: (message: string, color?: string) => void;
  teleport: (x: number, y: number, z: number, yaw?: number, pitch?: number) => void;
  setFlying: (flying: boolean) => void;
  setGameMode: (mode: GameMode) => void;
  setHealth: (health: number, food?: number) => void;
  kick: (reason: string) => void;
}

export interface ChatEvent {
  player: PluginPlayer;
  message: string;
  cancel: boolean;
}

export interface MoveEvent {
  player: PluginPlayer;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  cancel: boolean;
}

export interface BlockBreakEvent {
  player: PluginPlayer;
  x: number;
  y: number;
  z: number;
  blockStateId: number;
  cancel: boolean;
}

export interface PacketReceiveEvent {
  connectionId: string;
  player?: PluginPlayer;
  state: ProtocolState;
  packetId: number;
  packetName: string;
  sizeBytes: number;
  cancel: boolean;
}

export interface CommandContext {
  sender: PluginPlayer | 'CONSOLE';
  command: string;
  args: string[];
  raw: string;
  reply: (msg: string) => void;
}

export interface PluginHooks {
  onPlayerJoin?: (player: PluginPlayer) => void | Promise<void>;
  onPlayerQuit?: (player: PluginPlayer) => void | Promise<void>;
  onPlayerChat?: (event: ChatEvent) => void | Promise<void>;
  onPlayerMove?: (event: MoveEvent) => void | Promise<void>;
  onBlockBreak?: (event: BlockBreakEvent) => void | Promise<void>;
  onPacketReceive?: (event: PacketReceiveEvent) => void | Promise<void>;
  onCommand?: (ctx: CommandContext) => boolean | void | Promise<boolean | void>;
}

export interface PluginContext {
  log: (message: string, level?: LogLevel) => void;
  broadcast: (message: string) => void;
  getOnlinePlayers: () => PluginPlayer[];
  getPlayer: (username: string) => PluginPlayer | undefined;
  getLoadedPlugins: () => Array<{ name: string; version: string; enabled: boolean; commands: string[] }>;
  registerCommand: (
    name: string,
    handler: (ctx: CommandContext) => void | Promise<void>,
    options?: { description?: string; usage?: string; aliases?: string[] }
  ) => void;
  on: <K extends keyof PluginHooks>(event: K, handler: NonNullable<PluginHooks[K]>) => void;
}

export interface AetherPlugin {
  name: string;
  version: string;
  description: string;
  author?: string;
  onEnable: (ctx: PluginContext) => void | Promise<void>;
  onDisable?: () => void | Promise<void>;
}
