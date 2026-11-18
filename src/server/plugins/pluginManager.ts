import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { LogLevel, PluginMetadata } from '../../shared/types.ts';
import { loadPluginStates, savePluginStates } from '../configStore.ts';
import type {
  AetherPlugin,
  BlockBreakEvent,
  ChatEvent,
  CommandContext,
  MoveEvent,
  PacketReceiveEvent,
  PluginContext,
  PluginHooks,
  PluginPlayer,
} from './pluginApi.ts';

interface LoadedPluginEntry {
  id: string;
  filename: string;
  filePath: string;
  instance: AetherPlugin | null;
  metadata: PluginMetadata;
  commands: Map<string, (ctx: CommandContext) => void | Promise<void>>;
  hooks: { [K in keyof PluginHooks]-?: Array<NonNullable<PluginHooks[K]>> };
}

export interface PluginHostBridge {
  log: (source: string, message: string, level?: LogLevel) => void;
  broadcast: (message: string) => void;
  getOnlinePlayers: () => PluginPlayer[];
  getPlayer: (username: string) => PluginPlayer | undefined;
  onPluginsUpdated: (plugins: PluginMetadata[]) => void;
}

export class PluginManager {
  private readonly pluginsDir: string;
  private entries = new Map<string, LoadedPluginEntry>();
  private states: Record<string, boolean>;
  private bridge: PluginHostBridge;

  constructor(pluginsDir: string, bridge: PluginHostBridge) {
    this.pluginsDir = pluginsDir;
    this.bridge = bridge;
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }
    this.states = loadPluginStates();
  }

  private emptyHooks(): LoadedPluginEntry['hooks'] {
    return {
      onPlayerJoin: [],
      onPlayerQuit: [],
      onPlayerChat: [],
      onPlayerMove: [],
      onBlockBreak: [],
      onPacketReceive: [],
      onCommand: [],
    };
  }

  public async loadAll(): Promise<PluginMetadata[]> {
    const files = fs
      .readdirSync(this.pluginsDir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .sort();

    // Unload plugins whose files were removed
    for (const [id, entry] of this.entries.entries()) {
      if (!files.includes(entry.filename)) {
        await this.unloadPlugin(id);
        this.entries.delete(id);
      }
    }

    for (const filename of files) {
      await this.loadOrReloadFile(filename);
    }

    const list = this.getMetadataList();
    this.bridge.onPluginsUpdated(list);
    return list;
  }

  public async loadOrReloadFile(filename: string): Promise<PluginMetadata> {
    const filePath = path.join(this.pluginsDir, filename);
    const id = filename;

    // Cleanly disable & purge old instance if already loaded (Hot-Reload)
    if (this.entries.has(id)) {
      await this.unloadPlugin(id);
    }

    const isEnabled = this.states[id] ?? true;
    this.states[id] = isEnabled;
    savePluginStates(this.states);

    const entry: LoadedPluginEntry = {
      id,
      filename,
      filePath,
      instance: null,
      commands: new Map(),
      hooks: this.emptyHooks(),
      metadata: {
        id,
        filename,
        path: `plugins/${filename}`,
        name: filename.replace(/\.(ts|js)$/, ''),
        version: '1.0.0',
        description: 'Loading plugin...',
        author: 'Unknown',
        enabled: isEnabled,
        loadedAt: Date.now(),
        commands: [],
        hooks: [],
      },
    };

    try {
      // Cache-busting URL import ensures Bun / ESM discards previous module memory
      const url = `${pathToFileURL(filePath).href}?hot=${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const mod = (await import(url)) as { default?: AetherPlugin; plugin?: AetherPlugin };
      const plugin = mod.default ?? mod.plugin;

      if (!plugin || typeof plugin.onEnable !== 'function') {
        throw new Error('Plugin must export default object implementing AetherPlugin (name, version, onEnable)');
      }

      entry.instance = plugin;
      entry.metadata.name = plugin.name || entry.metadata.name;
      entry.metadata.version = plugin.version || '1.0.0';
      entry.metadata.description = plugin.description || 'Custom server plugin';
      entry.metadata.author = plugin.author || 'AetherCore';

      if (isEnabled) {
        const registeredCommandNames = new Set<string>();
        const activeHookNames = new Set<string>();

        const ctx: PluginContext = {
          log: (message, level = 'PLUGIN') => {
            this.bridge.log(plugin.name, message, level);
          },
          broadcast: (message) => {
            this.bridge.broadcast(message);
          },
          getOnlinePlayers: () => this.bridge.getOnlinePlayers(),
          getPlayer: (username) => this.bridge.getPlayer(username),
          getLoadedPlugins: () =>
            this.getMetadataList().map((p) => ({
              name: p.name,
              version: p.version,
              enabled: p.enabled,
              commands: p.commands,
            })),
          registerCommand: (name, handler, options) => {
            const clean = name.replace(/^\//, '').toLowerCase();
            entry.commands.set(clean, handler);
            registeredCommandNames.add(`/${clean}`);
            if (options?.aliases) {
              for (const alias of options.aliases) {
                entry.commands.set(alias.replace(/^\//, '').toLowerCase(), handler);
              }
            }
          },
          on: (event, handler) => {
            const arr = entry.hooks[event] as Array<typeof handler>;
            arr.push(handler);
            activeHookNames.add(event);
          },
        };

        await plugin.onEnable(ctx);
        entry.metadata.commands = Array.from(registeredCommandNames);
        entry.metadata.hooks = Array.from(activeHookNames);
        this.bridge.log('PluginManager', `Enabled ${plugin.name} v${plugin.version} (${entry.metadata.commands.join(', ') || 'no commands'})`, 'PLUGIN');
      } else {
        this.bridge.log('PluginManager', `Loaded ${plugin.name} v${plugin.version} (disabled)`, 'PLUGIN');
      }
    } catch (err) {
      const msg = (err as Error).message;
      entry.metadata.error = msg;
      this.bridge.log('PluginManager', `Failed to load ${filename}: ${msg}`, 'ERROR');
    }

    this.entries.set(id, entry);
    this.bridge.onPluginsUpdated(this.getMetadataList());
    return entry.metadata;
  }

  private async unloadPlugin(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    try {
      if (entry.metadata.enabled && entry.instance?.onDisable) {
        await entry.instance.onDisable();
      }
    } catch (err) {
      this.bridge.log('PluginManager', `Error in onDisable for ${entry.metadata.name}: ${(err as Error).message}`, 'WARN');
    }
    entry.commands.clear();
    entry.hooks = this.emptyHooks();
  }

  public async setPluginEnabled(id: string, enabled: boolean): Promise<PluginMetadata | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.states[id] = enabled;
    savePluginStates(this.states);
    return this.loadOrReloadFile(entry.filename);
  }

  public async reloadPlugin(id: string): Promise<PluginMetadata | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.bridge.log('PluginManager', `Hot-reloading plugin ${entry.filename}...`, 'PLUGIN');
    return this.loadOrReloadFile(entry.filename);
  }

  public async reloadByRelativePath(relPath: string): Promise<PluginMetadata | null> {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized.startsWith('plugins/')) return null;
    const filename = path.basename(normalized);
    if (!filename.endsWith('.ts') && !filename.endsWith('.js')) return null;
    this.bridge.log('PluginManager', `Auto Hot-Reload triggered for ${normalized}`, 'PLUGIN');
    return this.loadOrReloadFile(filename);
  }

  public createPluginTemplate(rawName: string): string {
    const safeName = rawName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/\.(ts|js)$/, '');
    if (!safeName) throw new Error('Invalid plugin name');
    const filename = `${safeName}.ts`;
    const targetPath = path.join(this.pluginsDir, filename);
    if (fs.existsSync(targetPath)) {
      throw new Error(`Plugin ${filename} already exists`);
    }

    const displayName = safeName
      .split(/[_-]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');

    const code = `import type { AetherPlugin } from '../src/server/plugins/pluginApi.ts';

const plugin: AetherPlugin = {
  name: '${displayName}',
  version: '1.0.0',
  description: 'Custom hot-reloadable plugin for AetherCore 26.3',
  author: 'ServerAdmin',

  onEnable(ctx) {
    ctx.log('${displayName} activated!');

    ctx.registerCommand('${safeName}', (cmd) => {
      cmd.reply('[${displayName}] Running cleanly on Protocol 777!');
    });

    ctx.on('onPlayerJoin', (player) => {
      player.sendMessage('Welcome to the server, ' + player.username + '!', 'green');
    });
  },

  onDisable() {
    // Cleanup timers or state before hot-reload
  },
};

export default plugin;
`;
    fs.writeFileSync(targetPath, code, 'utf-8');
    return filename;
  }

  public getMetadataList(): PluginMetadata[] {
    return Array.from(this.entries.values()).map((e) => e.metadata);
  }

  public async dispatchCommand(ctx: CommandContext): Promise<boolean> {
    const cmdName = ctx.command.toLowerCase();
    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      const handler = entry.commands.get(cmdName);
      if (handler) {
        try {
          await handler(ctx);
          return true;
        } catch (err) {
          ctx.reply(`Plugin command error (${entry.metadata.name}): ${(err as Error).message}`);
          this.bridge.log(entry.metadata.name, `Command /${cmdName} threw: ${(err as Error).message}`, 'ERROR');
          return true;
        }
      }
    }

    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      for (const hook of entry.hooks.onCommand) {
        try {
          const handled = await hook(ctx);
          if (handled) return true;
        } catch (err) {
          this.bridge.log(entry.metadata.name, `onCommand hook error: ${(err as Error).message}`, 'ERROR');
        }
      }
    }
    return false;
  }

  public async emitPlayerJoin(player: PluginPlayer): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      for (const hook of entry.hooks.onPlayerJoin) {
        try {
          await hook(player);
        } catch (err) {
          this.bridge.log(entry.metadata.name, `onPlayerJoin error: ${(err as Error).message}`, 'ERROR');
        }
      }
    }
  }

  public async emitPlayerQuit(player: PluginPlayer): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      for (const hook of entry.hooks.onPlayerQuit) {
        try {
          await hook(player);
        } catch (err) {
          this.bridge.log(entry.metadata.name, `onPlayerQuit error: ${(err as Error).message}`, 'ERROR');
        }
      }
    }
  }

  public async emitPlayerChat(event: ChatEvent): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      for (const hook of entry.hooks.onPlayerChat) {
        try {
          await hook(event);
          if (event.cancel) return;
        } catch (err) {
          this.bridge.log(entry.metadata.name, `onPlayerChat error: ${(err as Error).message}`, 'ERROR');
        }
      }
    }
  }

  public async emitPlayerMove(event: MoveEvent): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      for (const hook of entry.hooks.onPlayerMove) {
        try {
          await hook(event);
          if (event.cancel) return;
        } catch (err) {
          this.bridge.log(entry.metadata.name, `onPlayerMove error: ${(err as Error).message}`, 'ERROR');
        }
      }
    }
  }

  public async emitBlockBreak(event: BlockBreakEvent): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      for (const hook of entry.hooks.onBlockBreak) {
        try {
          await hook(event);
          if (event.cancel) return;
        } catch (err) {
          this.bridge.log(entry.metadata.name, `onBlockBreak error: ${(err as Error).message}`, 'ERROR');
        }
      }
    }
  }

  public async emitPacketReceive(event: PacketReceiveEvent): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.metadata.enabled) continue;
      for (const hook of entry.hooks.onPacketReceive) {
        try {
          await hook(event);
          if (event.cancel) return;
        } catch (err) {
          this.bridge.log(entry.metadata.name, `onPacketReceive error: ${(err as Error).message}`, 'ERROR');
        }
      }
    }
  }
}
