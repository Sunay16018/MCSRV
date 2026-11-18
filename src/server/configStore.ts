import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { BannedPlayer, SecurityConfig, ServerConfig } from '../shared/types.ts';

const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const BANS_PATH = path.join(ROOT_DIR, 'bans.json');
const OPS_PATH = path.join(ROOT_DIR, 'ops.json');
const PLUGINS_STATE_PATH = path.join(ROOT_DIR, 'plugins-state.json');

export const DEFAULT_SECURITY: SecurityConfig = {
  ipWhitelistEnabled: false,
  enforceMinecraftIpWhitelist: false,
  allowedIps: ['127.0.0.1', '::1'],
  protectWebPanel: false,
  panelAccessToken: '',
  maxConnectionsPerIp: 5,
  maxHandshakesPerMinute: 40,
};

export const DEFAULT_CONFIG: ServerConfig = {
  motd: 'AetherCore 26.3 — High-Speed Bun Minecraft Engine (1.21-26.3)',
  port: 25565,
  maxPlayers: 50,
  viewDistance: 6,
  simulationDistance: 6,
  gamemode: 'survival',
  difficulty: 'normal',
  compressionThreshold: 256,
  onlineMode: false,
  maxPacketSize: 2097152,
  worldType: 'superflat',
  spawnProtection: true,
  publicHost: '',
  security: { ...DEFAULT_SECURITY },
};

export function loadConfig(): ServerConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      return { ...DEFAULT_CONFIG, security: { ...DEFAULT_SECURITY } };
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ServerConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      security: {
        ...DEFAULT_SECURITY,
        ...(parsed.security ?? {}),
        allowedIps: Array.isArray(parsed.security?.allowedIps)
          ? parsed.security!.allowedIps.map((s) => String(s).trim()).filter(Boolean)
          : [...DEFAULT_SECURITY.allowedIps],
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG, security: { ...DEFAULT_SECURITY } };
  }
}

export function saveConfig(next: Partial<ServerConfig>): ServerConfig {
  const current = loadConfig();
  const nextSecurity: SecurityConfig = {
    ...current.security,
    ...(next.security ?? {}),
    allowedIps: Array.isArray(next.security?.allowedIps)
      ? Array.from(new Set(next.security!.allowedIps.map((s) => String(s).trim()).filter(Boolean)))
      : current.security.allowedIps,
    maxConnectionsPerIp: Math.max(
      1,
      Math.min(100, Number(next.security?.maxConnectionsPerIp ?? current.security.maxConnectionsPerIp) || 5)
    ),
    maxHandshakesPerMinute: Math.max(
      5,
      Math.min(600, Number(next.security?.maxHandshakesPerMinute ?? current.security.maxHandshakesPerMinute) || 40)
    ),
  };

  // Auto-generate a strong random panel access token when enabling panel protection if blank
  if (nextSecurity.protectWebPanel && !nextSecurity.panelAccessToken.trim()) {
    nextSecurity.panelAccessToken = crypto.randomBytes(24).toString('hex');
  }

  const merged: ServerConfig = {
    ...current,
    ...next,
    publicHost: String(next.publicHost ?? current.publicHost ?? '').trim(),
    port: Math.max(1024, Math.min(65535, Number(next.port ?? current.port) || 25565)),
    maxPlayers: Math.max(1, Math.min(1000, Number(next.maxPlayers ?? current.maxPlayers) || 50)),
    viewDistance: Math.max(2, Math.min(16, Number(next.viewDistance ?? current.viewDistance) || 6)),
    simulationDistance: Math.max(2, Math.min(16, Number(next.simulationDistance ?? current.simulationDistance) || 6)),
    compressionThreshold: Math.max(-1, Math.min(65535, Number(next.compressionThreshold ?? current.compressionThreshold) ?? 256)),
    maxPacketSize: Math.max(4096, Math.min(16777216, Number(next.maxPacketSize ?? current.maxPacketSize) || 2097152)),
    security: nextSecurity,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

export function loadBans(): BannedPlayer[] {
  try {
    if (!fs.existsSync(BANS_PATH)) {
      fs.writeFileSync(BANS_PATH, '[]', 'utf-8');
      return [];
    }
    return JSON.parse(fs.readFileSync(BANS_PATH, 'utf-8')) as BannedPlayer[];
  } catch {
    return [];
  }
}

export function saveBans(bans: BannedPlayer[]): void {
  fs.writeFileSync(BANS_PATH, JSON.stringify(bans, null, 2), 'utf-8');
}

export function loadOps(): Set<string> {
  try {
    if (!fs.existsSync(OPS_PATH)) {
      fs.writeFileSync(OPS_PATH, '["Admin"]', 'utf-8');
      return new Set(['admin']);
    }
    const arr = JSON.parse(fs.readFileSync(OPS_PATH, 'utf-8')) as string[];
    return new Set(arr.map((n) => n.toLowerCase()));
  } catch {
    return new Set(['admin']);
  }
}

export function saveOps(ops: Set<string>): void {
  fs.writeFileSync(OPS_PATH, JSON.stringify(Array.from(ops), null, 2), 'utf-8');
}

export function loadPluginStates(): Record<string, boolean> {
  try {
    if (!fs.existsSync(PLUGINS_STATE_PATH)) {
      fs.writeFileSync(PLUGINS_STATE_PATH, '{}', 'utf-8');
      return {};
    }
    return JSON.parse(fs.readFileSync(PLUGINS_STATE_PATH, 'utf-8')) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function savePluginStates(states: Record<string, boolean>): void {
  fs.writeFileSync(PLUGINS_STATE_PATH, JSON.stringify(states, null, 2), 'utf-8');
}
