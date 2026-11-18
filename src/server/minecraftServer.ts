import os from 'os';
import net from 'net';
import path from 'path';
import { EventEmitter } from 'events';
import type {
  BannedPlayer,
  ConsoleLog,
  GameMode,
  LogLevel,
  MetricSample,
  PacketDirection,
  PacketLogEntry,
  PlayerInfo,
  PluginMetadata,
  ProtocolState,
  ServerConfig,
  ServerMetrics,
  ServerStatus,
} from '../shared/types.ts';
import { loadBans, loadConfig, loadOps, saveBans, saveConfig, saveOps } from './configStore.ts';
import {
  extractOnePacketFromBuffer,
  framePacket,
  getServerFavicon,
  offlineUuid,
  PacketCodecError,
  PacketReader,
  PacketWriter,
} from './protocol/codec.ts';
import {
  PRIMARY_MINECRAFT_VERSION,
  PRIMARY_PROTOCOL_VERSION,
  ProtocolMapper,
  SUPPORTED_RANGE_LABEL,
  type ProtocolProfile,
} from './protocol/mapper.ts';
import { ConnectionRateLimiter, normalizeIp } from './security.ts';
import { WorldEngine } from './world/chunkGenerator.ts';
import { PluginManager } from './plugins/pluginManager.ts';
import type { PluginPlayer } from './plugins/pluginApi.ts';

interface TcpSocketAdapter {
  remoteAddress: string;
  write: (data: Uint8Array) => void;
  end: () => void;
}

interface ClientConnection {
  id: string;
  socket: TcpSocketAdapter;
  state: ProtocolState;
  buffer: Buffer;
  compressionThreshold: number;
  profile: ProtocolProfile;
  username?: string;
  uuid?: string;
  entityId?: number;
  isBotProbe: boolean;
  player?: InternalPlayer;
  lastKeepAliveId?: bigint;
  lastKeepAliveSentAt?: number;
  closed: boolean;
  processingQueue: Promise<void>;
}

interface InternalPlayer extends PlayerInfo {
  connection: ClientConnection;
}

const MAX_CONSOLE_LOGS = 400;
const MAX_PACKET_LOGS = 300;
const MAX_METRIC_HISTORY = 90;

export class MinecraftServerEngine extends EventEmitter {
  private config: ServerConfig;
  private status: ServerStatus = 'stopped';
  private tcpServer: { stop?: () => void; close?: () => void } | null = null;
  private worker: Worker | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  private connections = new Map<string, ClientConnection>();
  private players = new Map<string, InternalPlayer>(); // key = uuid
  private bans: BannedPlayer[] = [];
  private ops: Set<string> = new Set();

  private consoleLogs: ConsoleLog[] = [];
  private packetLogs: PacketLogEntry[] = [];
  private metricHistory: MetricSample[] = [];

  private nextEntityId = 100;
  private nextConnSeq = 1;
  private startedAt = 0;

  private tps = 20.0;
  private mspt = 0.4;
  private ramUsedMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  private ramTotalMb = Math.round(os.totalmem() / (1024 * 1024));
  private cpuPercent = 0.5;
  private tickCount = 0;
  private totalPacketsIn = 0;
  private totalPacketsOut = 0;
  private droppedPackets = 0;
  private blockedConnections = 0;
  private errorMessage: string | undefined;

  public readonly world = new WorldEngine();
  public readonly pluginManager: PluginManager;
  private readonly rateLimiter = new ConnectionRateLimiter();

  constructor() {
    super();
    this.config = loadConfig();
    this.bans = loadBans();
    this.ops = loadOps();
    this.world.setWorldType(this.config.worldType);

    this.pluginManager = new PluginManager(path.join(process.cwd(), 'plugins'), {
      log: (source, message, level = 'PLUGIN') => this.log(source, message, level),
      broadcast: (message) => this.broadcastChat(message),
      getOnlinePlayers: () => Array.from(this.players.values()).map((p) => this.toPluginPlayer(p)),
      getPlayer: (username) => {
        const found = this.findPlayerByName(username);
        return found ? this.toPluginPlayer(found) : undefined;
      },
      onPluginsUpdated: (plugins) => {
        this.emit('plugins', plugins);
      },
    });
  }

  public async initialize(): Promise<void> {
    await this.pluginManager.loadAll();
    await this.start();
  }

  public async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') return;
    this.status = 'starting';
    this.errorMessage = undefined;
    this.config = loadConfig();
    this.world.setWorldType(this.config.worldType);

    const runtime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'Bun' : 'Node';
    this.log('Engine', `Starting AetherCore ${PRIMARY_MINECRAFT_VERSION} (Protocol ${PRIMARY_PROTOCOL_VERSION}) on ${runtime} runtime...`, 'INFO');

    try {
      await this.bindTcpSocket(this.config.port);
      this.startTickWorker();
      this.startKeepAliveLoop();
      this.startedAt = Date.now();
      this.status = 'running';
      this.log('Network', `Minecraft TCP listener bound on 0.0.0.0:${this.config.port} (compression >= ${this.config.compressionThreshold}B)`, 'INFO');
      this.emitMetrics();
    } catch (err) {
      this.status = 'error';
      this.errorMessage = (err as Error).message;
      this.log('Engine', `Failed to start TCP listener on port ${this.config.port}: ${this.errorMessage}`, 'ERROR');
      this.emitMetrics();
    }
  }

  public async stop(): Promise<void> {
    if (this.status === 'stopped') return;
    this.status = 'stopping';
    this.log('Engine', 'Stopping Minecraft server gracefully...', 'WARN');

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    for (const conn of this.connections.values()) {
      this.disconnectConnection(conn, 'Server shutting down');
    }
    this.connections.clear();
    this.players.clear();
    this.emit('players', []);

    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      this.worker.terminate();
      this.worker = null;
    }

    if (this.tcpServer) {
      try {
        if (typeof this.tcpServer.stop === 'function') {
          this.tcpServer.stop();
        } else if (typeof this.tcpServer.close === 'function') {
          this.tcpServer.close();
        }
      } catch {
        // Ignore close errors
      }
      this.tcpServer = null;
    }

    this.status = 'stopped';
    this.startedAt = 0;
    this.tps = 0;
    this.mspt = 0;
    this.log('Engine', 'Minecraft server stopped.', 'INFO');
    this.emitMetrics();
  }

  public async restart(): Promise<void> {
    await this.stop();
    await this.pluginManager.loadAll();
    await this.start();
  }

  private async bindTcpSocket(port: number): Promise<void> {
    const bunGlobal = (globalThis as unknown as {
      Bun?: {
        listen: (opts: {
          hostname: string;
          port: number;
          socket: {
            open: (socket: { remoteAddress: string; write: (d: Uint8Array) => number; end: () => void; data: { connId?: string } }) => void;
            data: (socket: { data: { connId?: string } }, data: Uint8Array) => void;
            close: (socket: { data: { connId?: string } }) => void;
            error: (socket: { data: { connId?: string } }, err: Error) => void;
          };
        }) => { stop: (closeActive?: boolean) => void };
      };
    }).Bun;

    if (bunGlobal?.listen) {
      const server = bunGlobal.listen({
        hostname: '0.0.0.0',
        port,
        socket: {
          open: (socket) => {
            socket.data = {};
            const conn = this.handleSocketOpen({
              remoteAddress: socket.remoteAddress || '127.0.0.1',
              write: (d) => {
                try {
                  socket.write(d);
                } catch {
                  // Ignore broken pipe
                }
              },
              end: () => {
                try {
                  socket.end();
                } catch {
                  // Ignore
                }
              },
            });
            socket.data.connId = conn.id;
          },
          data: (socket, data) => {
            const conn = socket.data.connId ? this.connections.get(socket.data.connId) : undefined;
            if (conn) {
              this.handleSocketData(conn, Buffer.from(data));
            }
          },
          close: (socket) => {
            const conn = socket.data.connId ? this.connections.get(socket.data.connId) : undefined;
            if (conn) {
              this.handleSocketClose(conn);
            }
          },
          error: (socket, err) => {
            const conn = socket.data.connId ? this.connections.get(socket.data.connId) : undefined;
            if (conn) {
              this.log('Network', `Socket error (${conn.id}): ${err.message}`, 'WARN');
              this.handleSocketClose(conn);
            }
          },
        },
      });
      this.tcpServer = { stop: () => server.stop(true) };
      return;
    }

    // Fallback to node:net if ever run outside Bun
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        const conn = this.handleSocketOpen({
          remoteAddress: socket.remoteAddress || '127.0.0.1',
          write: (d) => {
            if (!socket.destroyed) socket.write(d);
          },
          end: () => {
            if (!socket.destroyed) socket.end();
          },
        });
        socket.on('data', (chunk) => this.handleSocketData(conn, chunk));
        socket.on('close', () => this.handleSocketClose(conn));
        socket.on('error', () => this.handleSocketClose(conn));
      });
      server.on('error', reject);
      server.listen(port, '0.0.0.0', () => {
        this.tcpServer = { close: () => server.close() };
        resolve();
      });
    });
  }

  private startTickWorker(): void {
    const workerUrl = new URL('./tickWorker.ts', import.meta.url).href;
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (event: MessageEvent<{
      type: string;
      tickCount: number;
      tps: number;
      mspt: number;
      telemetry?: {
        tps: number;
        mspt: number;
        ramUsedMb: number;
        ramTotalMb: number;
        cpuPercent: number;
        tickCount: number;
      } | null;
    }>) => {
      const data = event.data;
      if (data.type === 'tick') {
        this.tickCount = data.tickCount;
        this.tps = data.tps;
        this.mspt = data.mspt;
        if (data.telemetry) {
          this.ramUsedMb = data.telemetry.ramUsedMb;
          this.ramTotalMb = data.telemetry.ramTotalMb;
          this.cpuPercent = data.telemetry.cpuPercent;
          this.emitMetrics();
        }
      }
    };
    this.worker.postMessage({ type: 'start' });
  }

  private startKeepAliveLoop(): void {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(() => {
      if (this.status !== 'running') return;
      const now = Date.now();
      for (const player of this.players.values()) {
        const conn = player.connection;
        if (conn.closed || conn.state !== 'PLAY') continue;
        const keepAliveId = BigInt(now);
        conn.lastKeepAliveId = keepAliveId;
        conn.lastKeepAliveSentAt = now;
        const w = new PacketWriter().writeLong(keepAliveId);
        this.sendPacket(conn, conn.profile.clientbound.PLAY.keep_alive, w.toBuffer());
      }
    }, 5000);
  }

  private handleSocketOpen(socket: TcpSocketAdapter): ClientConnection {
    const id = `conn_${this.nextConnSeq++}`;
    const cleanIp = normalizeIp(socket.remoteAddress);
    let activeFromIp = 0;
    for (const c of this.connections.values()) {
      if (!c.closed && normalizeIp(c.socket.remoteAddress) === cleanIp) {
        activeFromIp++;
      }
    }

    const check = this.rateLimiter.checkAllowed(cleanIp, activeFromIp, this.config.security);

    const conn: ClientConnection = {
      id,
      socket,
      state: 'HANDSHAKE',
      buffer: Buffer.alloc(0),
      compressionThreshold: -1,
      profile: ProtocolMapper.resolveProfile(PRIMARY_PROTOCOL_VERSION),
      isBotProbe: false,
      closed: false,
      processingQueue: Promise.resolve(),
    };

    if (!check.allowed) {
      this.blockedConnections++;
      this.log('Security', `Blocked TCP connection from ${cleanIp}: ${check.reason}`, 'WARN');
      conn.closed = true;
      socket.end();
      return conn;
    }

    this.connections.set(id, conn);
    return conn;
  }

  // Crash-Proof Packet Shield: isolates malformed buffers, invalid VarInts, Zlib errors, and handler exceptions
  private handleSocketData(conn: ClientConnection, chunk: Buffer): void {
    if (conn.closed) return;

    conn.processingQueue = conn.processingQueue
      .then(async () => {
        if (conn.closed) return;
        try {
          conn.buffer = conn.buffer.length === 0 ? chunk : Buffer.concat([conn.buffer, chunk]);
          if (conn.buffer.length > this.config.maxPacketSize * 2) {
            throw new PacketCodecError(`Receive buffer overflow (${conn.buffer.length} bytes)`);
          }

          while (conn.buffer.length > 0 && !conn.closed) {
            const { packet: pkt, remaining } = extractOnePacketFromBuffer(
              conn.buffer,
              conn.compressionThreshold,
              this.config.maxPacketSize
            );
            conn.buffer = remaining;
            if (!pkt) break;

            this.totalPacketsIn++;
            const packetName = ProtocolMapper.getServerboundName(conn.state, pkt.packetId, conn.profile);

            this.recordPacket({
              direction: 'INBOUND',
              connectionId: conn.id,
              playerName: conn.username,
              state: conn.state,
              packetId: pkt.packetId,
              packetName,
              sizeBytes: pkt.rawSize,
              compressed: pkt.compressed,
              summary: this.summarizeInbound(conn.state, pkt.packetId, pkt.payload),
              hexPreview: pkt.payload.subarray(0, 32).toString('hex'),
            });

            try {
              await this.dispatchPacket(conn, pkt.packetId, packetName, pkt.payload);
            } catch (handlerErr) {
              this.droppedPackets++;
              const msg = (handlerErr as Error).message;
              this.recordPacket({
                direction: 'SHIELD_DROP',
                connectionId: conn.id,
                playerName: conn.username,
                state: conn.state,
                packetId: pkt.packetId,
                packetName,
                sizeBytes: pkt.rawSize,
                compressed: pkt.compressed,
                summary: `Dropped malformed payload in ${packetName}`,
                hexPreview: pkt.payload.subarray(0, 32).toString('hex'),
                error: msg,
              });
              this.log('PacketShield', `Dropped malformed ${packetName} from ${conn.username ?? conn.id}: ${msg}`, 'WARN');
            }
          }
        } catch (shieldErr) {
          this.droppedPackets++;
          const msg = (shieldErr as Error).message;
          this.recordPacket({
            direction: 'SHIELD_DROP',
            connectionId: conn.id,
            playerName: conn.username,
            state: conn.state,
            packetId: -1,
            packetName: 'corrupted_frame',
            sizeBytes: chunk.length,
            compressed: false,
            summary: 'Crash-Proof Shield neutralized corrupted TCP frame',
            hexPreview: chunk.subarray(0, 32).toString('hex'),
            error: msg,
          });
          this.log('PacketShield', `Shield neutralized malformed TCP stream (${conn.id}): ${msg}`, 'WARN');
          conn.buffer = Buffer.alloc(0);
          if (conn.state !== 'PLAY') {
            this.disconnectConnection(conn, `Protocol Shield: ${msg}`);
          }
        }
      })
      .catch(() => {});
  }

  private async dispatchPacket(
    conn: ClientConnection,
    packetId: number,
    packetName: string,
    payload: Buffer
  ): Promise<void> {
    // Allow plugins to inspect or cancel any packet
    const pluginEvt = {
      connectionId: conn.id,
      player: conn.player ? this.toPluginPlayer(conn.player) : undefined,
      state: conn.state,
      packetId,
      packetName,
      sizeBytes: payload.length,
      cancel: false,
    };
    await this.pluginManager.emitPacketReceive(pluginEvt);
    if (pluginEvt.cancel) return;

    const reader = new PacketReader(payload);

    if (conn.state === 'HANDSHAKE') {
      if (packetId === 0x00) {
        const protocolVersion = reader.readVarInt();
        const serverAddress = reader.readString(255);
        const serverPort = reader.readUShort();
        const nextState = reader.readVarInt();

        conn.profile = ProtocolMapper.resolveProfile(protocolVersion);
        if (serverAddress.includes('aetherprobe')) {
          conn.isBotProbe = true;
        }

        if (nextState === 1) {
          conn.state = 'STATUS';
        } else if (nextState === 2 || nextState === 3) {
          if (!ProtocolMapper.isSupported(protocolVersion)) {
            conn.state = 'LOGIN';
            this.disconnectConnection(
              conn,
              `Unsupported protocol ${protocolVersion}. Supported versions: ${SUPPORTED_RANGE_LABEL} (Protocols 767-777).`
            );
            return;
          }
          const viaActive = this.pluginManager
            .getMetadataList()
            .some((p) => p.name === 'ViaBackwards' && p.enabled);
          if (protocolVersion !== PRIMARY_PROTOCOL_VERSION && !viaActive) {
            conn.state = 'LOGIN';
            this.disconnectConnection(
              conn,
              `Outdated client (${conn.profile.label}). Enable ViaBackwards plugin to join with ${SUPPORTED_RANGE_LABEL}.`
            );
            return;
          }
          conn.state = 'LOGIN';
        } else {
          throw new PacketCodecError(`Invalid handshake nextState: ${nextState}`);
        }
        this.log(
          'Protocol',
          `Handshake from ${conn.socket.remoteAddress} -> proto=${protocolVersion} (${conn.profile.label}), addr=${serverAddress}:${serverPort}, next=${conn.state}`,
          'PROTOCOL'
        );
      }
      return;
    }

    if (conn.state === 'STATUS') {
      if (packetId === 0x00) {
        const sample = Array.from(this.players.values())
          .slice(0, 12)
          .map((p) => ({ name: p.username, id: p.uuid }));
        const statusJson = JSON.stringify({
          version: {
            name: PRIMARY_MINECRAFT_VERSION,
            protocol: PRIMARY_PROTOCOL_VERSION,
          },
          players: {
            max: this.config.maxPlayers,
            online: this.players.size,
            sample,
          },
          description: {
            text: this.config.motd,
          },
          favicon: getServerFavicon(),
          enforcesSecureChat: false,
        });
        const w = new PacketWriter().writeString(statusJson);
        this.sendPacket(conn, 0x00, w.toBuffer());
      } else if (packetId === 0x01) {
        const timePayload = reader.readLong();
        const w = new PacketWriter().writeLong(timePayload);
        this.sendPacket(conn, 0x01, w.toBuffer());
      }
      return;
    }

    if (conn.state === 'LOGIN') {
      if (packetId === 0x00) {
        const username = reader.readString(16);
        let clientUuid: string | undefined;
        if (reader.remaining >= 16) {
          clientUuid = reader.readUUID();
        }
        const resolvedUuid = this.config.onlineMode && clientUuid ? clientUuid : offlineUuid(username);

        // Check bans & player cap
        const banned = this.bans.find(
          (b) => b.username.toLowerCase() === username.toLowerCase() || b.uuid === resolvedUuid
        );
        if (banned) {
          this.disconnectConnection(conn, `You are banned: ${banned.reason}`);
          return;
        }
        if (this.players.size >= this.config.maxPlayers) {
          this.disconnectConnection(conn, 'Server is full!');
          return;
        }
        if (this.findPlayerByName(username)) {
          this.disconnectConnection(conn, `Player ${username} is already connected.`);
          return;
        }

        conn.username = username;
        conn.uuid = resolvedUuid;

        // 1. Send Set Compression if configured >= 0
        if (this.config.compressionThreshold >= 0) {
          const compWriter = new PacketWriter().writeVarInt(this.config.compressionThreshold);
          this.sendPacket(conn, conn.profile.clientbound.LOGIN.set_compression, compWriter.toBuffer());
          conn.compressionThreshold = this.config.compressionThreshold;
        }

        // 2. Send Login Success (UUID + Username + 0 properties + optional strictErrorHandling for 1.21)
        const successWriter = new PacketWriter()
          .writeUUID(resolvedUuid)
          .writeString(username)
          .writeVarInt(0);
        if (conn.profile.hasStrictLoginSuccessFlag) {
          successWriter.writeBoolean(false);
        }
        this.sendPacket(conn, conn.profile.clientbound.LOGIN.login_success, successWriter.toBuffer());
        this.log('Login', `${username} (${resolvedUuid}) authenticated via ${conn.profile.label}`, 'INFO');
      } else if (packetId === 0x03) {
        // Login Acknowledged -> Configuration State
        conn.state = 'CONFIGURATION';
        this.beginConfigurationPhase(conn);
      }
      return;
    }

    if (conn.state === 'CONFIGURATION') {
      if (packetName === 'client_information') {
        // Acknowledge known packs (minecraft:core 26.3)
        const kp = new PacketWriter()
          .writeVarInt(1)
          .writeString('minecraft')
          .writeString('core')
          .writeString(PRIMARY_MINECRAFT_VERSION);
        this.sendPacket(conn, conn.profile.clientbound.CONFIGURATION.select_known_packs, kp.toBuffer());
      } else if (packetName === 'select_known_packs') {
        this.sendConfigurationRegistries(conn);
        // Send Finish Configuration
        this.sendPacket(conn, conn.profile.clientbound.CONFIGURATION.finish_configuration, Buffer.alloc(0));
      } else if (packetName === 'finish_configuration') {
        conn.state = 'PLAY';
        await this.enterPlayPhase(conn);
      }
      return;
    }

    if (conn.state === 'PLAY' && conn.player) {
      const player = conn.player;

      if (packetName === 'keep_alive') {
        const id = reader.readLong();
        if (conn.lastKeepAliveId === id && conn.lastKeepAliveSentAt) {
          player.ping = Math.max(1, Date.now() - conn.lastKeepAliveSentAt);
          this.emitPlayers();
        }
        return;
      }

      if (packetName === 'chat') {
        const msg = reader.readString(256);
        await this.handlePlayerChat(player, msg);
        return;
      }

      if (packetName === 'chat_command' || packetName === 'chat_command_signed') {
        const cmdLine = reader.readString(256);
        await this.executeCommand(this.toPluginPlayer(player), cmdLine);
        return;
      }

      if (
        packetName === 'move_player_pos' ||
        packetName === 'move_player_pos_rot' ||
        packetName === 'move_player_rot'
      ) {
        const from = { x: player.x, y: player.y, z: player.z };
        let nextX = player.x;
        let nextY = player.y;
        let nextZ = player.z;
        let nextYaw = player.yaw;
        let nextPitch = player.pitch;

        if (packetName === 'move_player_pos' || packetName === 'move_player_pos_rot') {
          nextX = reader.readDouble();
          nextY = reader.readDouble();
          nextZ = reader.readDouble();
        }
        if (packetName === 'move_player_rot' || packetName === 'move_player_pos_rot') {
          nextYaw = reader.readFloat();
          nextPitch = reader.readFloat();
        }

        const moveEvt = {
          player: this.toPluginPlayer(player),
          from,
          to: { x: nextX, y: nextY, z: nextZ },
          cancel: false,
        };
        await this.pluginManager.emitPlayerMove(moveEvt);

        if (moveEvt.cancel) {
          this.teleportPlayer(player, from.x, from.y, from.z, player.yaw, player.pitch);
          return;
        }

        player.x = nextX;
        player.y = nextY;
        player.z = nextZ;
        player.yaw = nextYaw;
        player.pitch = nextPitch;
        this.broadcastPlayerPosition(player);
        this.emitPlayers();
        return;
      }

      if (packetName === 'player_action') {
        const status = reader.readVarInt();
        const pos = reader.readPosition();
        // status 0 = started digging, 2 = finished digging
        if (status === 0 || status === 2) {
          const currentBlock = this.world.getBlock(pos.x, pos.y, pos.z);
          if (currentBlock !== 0) {
            const breakEvt = {
              player: this.toPluginPlayer(player),
              x: pos.x,
              y: pos.y,
              z: pos.z,
              blockStateId: currentBlock,
              cancel: false,
            };
            await this.pluginManager.emitBlockBreak(breakEvt);
            if (!breakEvt.cancel) {
              this.world.setBlock(pos.x, pos.y, pos.z, 0);
              this.broadcastBlockUpdate(pos.x, pos.y, pos.z, 0);
              this.log('World', `${player.username} broke block at (${pos.x}, ${pos.y}, ${pos.z})`, 'INFO');
            } else {
              this.broadcastBlockUpdate(pos.x, pos.y, pos.z, currentBlock);
            }
          }
        }
        return;
      }

      if (packetName === 'use_item_on') {
        reader.readVarInt(); // hand
        const pos = reader.readPosition();
        const face = reader.readVarInt();
        const offsets = [
          [0, -1, 0],
          [0, 1, 0],
          [0, 0, -1],
          [0, 0, 1],
          [-1, 0, 0],
          [1, 0, 0],
        ];
        const [dx, dy, dz] = offsets[face] ?? [0, 1, 0];
        const tx = pos.x + dx;
        const ty = pos.y + dy;
        const tz = pos.z + dz;
        this.world.setBlock(tx, ty, tz, 14); // oak_planks
        this.broadcastBlockUpdate(tx, ty, tz, 14);
        this.log('World', `${player.username} placed oak_planks at (${tx}, ${ty}, ${tz})`, 'INFO');
      }
    }
  }

  private beginConfigurationPhase(conn: ClientConnection): void {
    // Send server brand via Custom Payload
    const brand = new PacketWriter().writeString('minecraft:brand').writeString('AetherCore 26.3');
    this.sendPacket(conn, conn.profile.clientbound.CONFIGURATION.custom_payload, brand.toBuffer());
  }

  private sendConfigurationRegistries(conn: ClientConnection): void {
    const registries: Array<{ id: string; entries: string[] }> = [
      { id: 'minecraft:dimension_type', entries: ['minecraft:overworld'] },
      { id: 'minecraft:biome', entries: ['minecraft:plains'] },
      { id: 'minecraft:chat_type', entries: ['minecraft:chat'] },
      { id: 'minecraft:damage_type', entries: ['minecraft:generic', 'minecraft:out_of_world'] },
      { id: 'minecraft:wolf_variant', entries: ['minecraft:pale'] },
      { id: 'minecraft:painting_variant', entries: ['minecraft:kebab'] },
    ];

    for (const reg of registries) {
      const w = new PacketWriter().writeString(reg.id).writeVarInt(reg.entries.length);
      for (const entryId of reg.entries) {
        w.writeString(entryId);
        w.writeBoolean(false); // no extra NBT override needed for minimal core pack
      }
      this.sendPacket(conn, conn.profile.clientbound.CONFIGURATION.registry_data, w.toBuffer());
    }
  }

  private async enterPlayPhase(conn: ClientConnection): Promise<void> {
    if (!conn.username || !conn.uuid) return;
    const entityId = this.nextEntityId++;
    const isOp = this.ops.has(conn.username.toLowerCase());

    const player: InternalPlayer = {
      id: conn.uuid,
      entityId,
      username: conn.username,
      uuid: conn.uuid,
      ip: conn.socket.remoteAddress,
      protocolVersion: conn.profile.protocolVersion,
      clientVersionLabel: conn.profile.label,
      viaTranslated: conn.profile.viaTranslated,
      ping: 12,
      x: 0.5,
      y: 64.0,
      z: 0.5,
      yaw: 0,
      pitch: 0,
      gamemode: this.config.gamemode,
      isOp,
      isFlying: this.config.gamemode === 'creative' || this.config.gamemode === 'spectator',
      health: 20,
      food: 20,
      connectedAt: Date.now(),
      isBotProbe: conn.isBotProbe,
      connection: conn,
    };

    conn.entityId = entityId;
    conn.player = player;
    this.players.set(player.uuid, player);

    // 1. Send Login (Play)
    const loginPlay = new PacketWriter()
      .writeInt(entityId)
      .writeBoolean(false) // isHardcore
      .writeVarInt(1)
      .writeString('minecraft:overworld')
      .writeVarInt(this.config.maxPlayers)
      .writeVarInt(this.config.viewDistance)
      .writeVarInt(this.config.simulationDistance)
      .writeBoolean(false) // reducedDebugInfo
      .writeBoolean(true) // enableRespawnScreen
      .writeBoolean(false) // doLimitedCrafting
      .writeVarInt(0) // dimensionType
      .writeString('minecraft:overworld')
      .writeLong(0n) // hashedSeed
      .writeUByte(this.gameModeToByte(player.gamemode))
      .writeByte(-1) // previousGamemode
      .writeBoolean(false) // isDebug
      .writeBoolean(this.config.worldType === 'superflat')
      .writeBoolean(false) // hasDeathLocation
      .writeVarInt(0) // portalCooldown
      .writeVarInt(63); // seaLevel
    this.sendPacket(conn, conn.profile.clientbound.PLAY.login_play, loginPlay.toBuffer());

    // 2. Game Event (13 = Start waiting for level chunks)
    const gameEvt = new PacketWriter().writeUByte(13).writeFloat(0);
    this.sendPacket(conn, conn.profile.clientbound.PLAY.game_event, gameEvt.toBuffer());

    // 3. Set Default Spawn Position & Chunk Cache Center
    const spawnPos = new PacketWriter().writePosition(0, 64, 0).writeFloat(0);
    this.sendPacket(conn, conn.profile.clientbound.PLAY.set_default_spawn_position, spawnPos.toBuffer());

    const chunkCenter = new PacketWriter().writeVarInt(0).writeVarInt(0);
    this.sendPacket(conn, conn.profile.clientbound.PLAY.set_chunk_cache_center, chunkCenter.toBuffer());

    // 4. Stream surrounding chunks so player never falls into the void
    const radius = Math.min(3, this.config.viewDistance);
    for (let cx = -radius; cx <= radius; cx++) {
      for (let cz = -radius; cz <= radius; cz++) {
        const chunkPayload = this.world.buildChunkPacketPayload(cx, cz, conn.profile.usesFlatHeightmaps);
        this.sendPacket(conn, conn.profile.clientbound.PLAY.level_chunk_with_light, chunkPayload);
      }
    }

    // 5. Synchronize Player Position (y=64 above grass at y=63)
    this.sendSynchronizePosition(player);

    // 6. Broadcast join to existing players & sync existing players to joiner
    this.broadcastPlayerInfoAdd(player);
    for (const other of this.players.values()) {
      if (other.uuid !== player.uuid) {
        this.sendPlayerInfoAddTo(conn, other);
        this.sendSpawnEntityTo(conn, other);
        this.sendSpawnEntityTo(other.connection, player);
      }
    }

    this.log('Join', `${player.username} joined the game at (0.5, 64.0, 0.5) [${player.clientVersionLabel}]`, 'INFO');
    this.emitPlayers();
    await this.pluginManager.emitPlayerJoin(this.toPluginPlayer(player));
  }

  private async handlePlayerChat(player: InternalPlayer, message: string): Promise<void> {
    if (message.startsWith('/')) {
      await this.executeCommand(this.toPluginPlayer(player), message.slice(1));
      return;
    }

    const evt = {
      player: this.toPluginPlayer(player),
      message,
      cancel: false,
    };
    await this.pluginManager.emitPlayerChat(evt);
    if (evt.cancel) return;

    const formatted = `<${player.username}> ${evt.message}`;
    this.log('Chat', formatted, 'CHAT');
    this.broadcastChat(formatted);
  }

  public async executeCommand(sender: PluginPlayer | 'CONSOLE', rawInput: string): Promise<string> {
    const clean = rawInput.trim().replace(/^\//, '');
    if (!clean) return '';
    const parts = clean.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    const replies: string[] = [];
    const reply = (msg: string) => {
      replies.push(msg);
      if (sender === 'CONSOLE') {
        this.log('Console', msg, 'INFO');
      } else {
        sender.sendMessage(msg, 'gray');
      }
    };

    if (sender !== 'CONSOLE') {
      this.log('Command', `${sender.username} issued server command: /${clean}`, 'INFO');
    }

    // Check plugins first (allows hot-reloaded commands like /fly, /tp, /gamemode, /heal, /plugins)
    const handledByPlugin = await this.pluginManager.dispatchCommand({
      sender,
      command,
      args,
      raw: clean,
      reply,
    });
    if (handledByPlugin) {
      return replies.join('\n');
    }

    // Built-in core server commands
    switch (command) {
      case 'help': {
        reply('Core commands: /help, /list, /say <msg>, /kick <player> [reason], /op <player>, /deop <player>, /ban <player> [reason], /reload, /stop');
        reply('Plugin commands: /fly, /tp, /gamemode, /heal, /plugins');
        break;
      }
      case 'list': {
        const names = Array.from(this.players.values()).map((p) => p.username);
        reply(`Online (${names.length}/${this.config.maxPlayers}): ${names.join(', ') || 'None'}`);
        break;
      }
      case 'say': {
        const text = args.join(' ');
        if (!text) {
          reply('Usage: /say <message>');
        } else {
          const line = `[Server] ${text}`;
          this.log('Broadcast', line, 'CHAT');
          this.broadcastChat(line);
        }
        break;
      }
      case 'kick': {
        if (!args[0]) {
          reply('Usage: /kick <player> [reason]');
          break;
        }
        const reason = args.slice(1).join(' ') || 'Kicked by an operator';
        const ok = this.kickPlayer(args[0], reason);
        reply(ok ? `Kicked ${args[0]}: ${reason}` : `Player "${args[0]}" not found.`);
        break;
      }
      case 'op': {
        if (!args[0]) {
          reply('Usage: /op <player>');
          break;
        }
        this.setOp(args[0], true);
        reply(`Made ${args[0]} a server operator.`);
        break;
      }
      case 'deop': {
        if (!args[0]) {
          reply('Usage: /deop <player>');
          break;
        }
        this.setOp(args[0], false);
        reply(`Removed operator status from ${args[0]}.`);
        break;
      }
      case 'ban': {
        if (!args[0]) {
          reply('Usage: /ban <player> [reason]');
          break;
        }
        const reason = args.slice(1).join(' ') || 'Banned by an operator';
        this.banPlayer(args[0], reason);
        reply(`Banned ${args[0]}: ${reason}`);
        break;
      }
      case 'reload': {
        await this.pluginManager.loadAll();
        reply('All plugins hot-reloaded.');
        break;
      }
      case 'stop': {
        reply('Initiating server shutdown...');
        void this.stop();
        break;
      }
      default: {
        reply(`Unknown command: /${command}. Type /help for available commands.`);
      }
    }

    return replies.join('\n');
  }

  public kickPlayer(username: string, reason = 'Kicked from server'): boolean {
    const target = this.findPlayerByName(username);
    if (!target) return false;
    this.disconnectConnection(target.connection, reason);
    this.log('Admin', `Kicked ${target.username}: ${reason}`, 'WARN');
    return true;
  }

  public banPlayer(username: string, reason = 'Banned by operator'): BannedPlayer {
    const target = this.findPlayerByName(username);
    const existing = this.bans.find((b) => b.username.toLowerCase() === username.toLowerCase());
    const entry: BannedPlayer = existing ?? {
      username: target?.username ?? username,
      uuid: target?.uuid ?? offlineUuid(username),
      reason,
      bannedAt: Date.now(),
    };
    entry.reason = reason;
    if (!existing) this.bans.push(entry);
    saveBans(this.bans);
    if (target) {
      this.disconnectConnection(target.connection, `You are banned: ${reason}`);
    }
    this.emit('bans', this.getBans());
    this.log('Admin', `Banned ${entry.username}: ${reason}`, 'WARN');
    return entry;
  }

  public unbanPlayer(username: string): boolean {
    const before = this.bans.length;
    this.bans = this.bans.filter((b) => b.username.toLowerCase() !== username.toLowerCase());
    if (this.bans.length !== before) {
      saveBans(this.bans);
      this.emit('bans', this.getBans());
      this.log('Admin', `Unbanned ${username}`, 'INFO');
      return true;
    }
    return false;
  }

  public setOp(username: string, op: boolean): void {
    const lower = username.toLowerCase();
    if (op) {
      this.ops.add(lower);
    } else {
      this.ops.delete(lower);
    }
    saveOps(this.ops);
    const target = this.findPlayerByName(username);
    if (target) {
      target.isOp = op;
      this.sendPlayerChat(target, op ? 'You are now a server operator.' : 'You are no longer a server operator.');
      this.emitPlayers();
    }
  }

  public teleportPlayer(player: InternalPlayer, x: number, y: number, z: number, yaw = player.yaw, pitch = player.pitch): void {
    player.x = x;
    player.y = y;
    player.z = z;
    player.yaw = yaw;
    player.pitch = pitch;
    this.sendSynchronizePosition(player);
    this.broadcastPlayerPosition(player);
    this.emitPlayers();
  }

  private sendSynchronizePosition(player: InternalPlayer): void {
    const w = new PacketWriter()
      .writeVarInt(1) // teleportId
      .writeDouble(player.x)
      .writeDouble(player.y)
      .writeDouble(player.z)
      .writeDouble(0) // dx
      .writeDouble(0) // dy
      .writeDouble(0) // dz
      .writeFloat(player.yaw)
      .writeFloat(player.pitch)
      .writeInt(0); // flags
    this.sendPacket(player.connection, player.connection.profile.clientbound.PLAY.player_position, w.toBuffer());
  }

  private sendPlayerAbilities(player: InternalPlayer): void {
    let flags = 0;
    if (player.gamemode === 'creative' || player.gamemode === 'spectator') flags |= 0x01; // invulnerable
    if (player.isFlying) flags |= 0x02; // flying
    if (player.isFlying || player.gamemode === 'creative' || player.gamemode === 'spectator') flags |= 0x04; // allow flying
    if (player.gamemode === 'creative') flags |= 0x08; // instant break

    const w = new PacketWriter()
      .writeByte(flags)
      .writeFloat(0.05)
      .writeFloat(0.1);
    this.sendPacket(player.connection, player.connection.profile.clientbound.PLAY.player_abilities, w.toBuffer());
  }

  private sendPlayerHealth(player: InternalPlayer): void {
    const w = new PacketWriter()
      .writeFloat(player.health)
      .writeVarInt(player.food)
      .writeFloat(5.0);
    this.sendPacket(player.connection, player.connection.profile.clientbound.PLAY.set_health, w.toBuffer());
  }

  private sendPlayerChat(player: InternalPlayer, message: string): void {
    if (player.connection.closed || player.connection.state !== 'PLAY') return;
    const w = new PacketWriter().writeNbtTextComponent(message).writeBoolean(false);
    this.sendPacket(player.connection, player.connection.profile.clientbound.PLAY.chat_system, w.toBuffer());
  }

  public broadcastChat(message: string): void {
    for (const player of this.players.values()) {
      this.sendPlayerChat(player, message);
    }
  }

  private broadcastBlockUpdate(x: number, y: number, z: number, stateId: number): void {
    const w = new PacketWriter().writePosition(x, y, z).writeVarInt(stateId);
    const payload = w.toBuffer();
    for (const player of this.players.values()) {
      this.sendPacket(player.connection, player.connection.profile.clientbound.PLAY.block_update, payload);
    }
  }

  private broadcastPlayerInfoAdd(joined: InternalPlayer): void {
    for (const recipient of this.players.values()) {
      this.sendPlayerInfoAddTo(recipient.connection, joined);
    }
  }

  private sendPlayerInfoAddTo(conn: ClientConnection, subject: InternalPlayer): void {
    // Actions bitmask: 0x01 Add Player + 0x04 Update GameMode + 0x08 Update Listed + 0x10 Update Latency
    const w = new PacketWriter()
      .writeUByte(0x01 | 0x04 | 0x08 | 0x10)
      .writeVarInt(1)
      .writeUUID(subject.uuid)
      .writeString(subject.username)
      .writeVarInt(0) // properties
      .writeVarInt(this.gameModeToByte(subject.gamemode))
      .writeBoolean(true) // listed
      .writeVarInt(subject.ping);
    this.sendPacket(conn, conn.profile.clientbound.PLAY.player_info_update, w.toBuffer());
  }

  private sendSpawnEntityTo(conn: ClientConnection, subject: InternalPlayer): void {
    const w = new PacketWriter()
      .writeVarInt(subject.entityId)
      .writeUUID(subject.uuid)
      .writeVarInt(128) // minecraft:player entity type
      .writeDouble(subject.x)
      .writeDouble(subject.y)
      .writeDouble(subject.z)
      .writeUByte(Math.floor((subject.pitch * 256) / 360) & 0xff)
      .writeUByte(Math.floor((subject.yaw * 256) / 360) & 0xff)
      .writeUByte(Math.floor((subject.yaw * 256) / 360) & 0xff)
      .writeVarInt(0)
      .writeShort(0)
      .writeShort(0)
      .writeShort(0);
    this.sendPacket(conn, conn.profile.clientbound.PLAY.spawn_entity, w.toBuffer());
  }

  private broadcastPlayerPosition(moved: InternalPlayer): void {
    const w = new PacketWriter()
      .writeVarInt(moved.entityId)
      .writeDouble(moved.x)
      .writeDouble(moved.y)
      .writeDouble(moved.z)
      .writeDouble(0)
      .writeDouble(0)
      .writeDouble(0)
      .writeFloat(moved.yaw)
      .writeFloat(moved.pitch)
      .writeInt(0);
    const buf = w.toBuffer();
    for (const other of this.players.values()) {
      if (other.uuid !== moved.uuid) {
        this.sendPacket(other.connection, other.connection.profile.clientbound.PLAY.teleport_entity, buf);
      }
    }
  }

  private disconnectConnection(conn: ClientConnection, reason: string): void {
    if (conn.closed) return;
    try {
      if (conn.state === 'LOGIN') {
        const w = new PacketWriter().writeString(JSON.stringify({ text: reason }));
        this.sendPacket(conn, conn.profile.clientbound.LOGIN.disconnect, w.toBuffer());
      } else if (conn.state === 'CONFIGURATION') {
        const w = new PacketWriter().writeNbtTextComponent(reason);
        this.sendPacket(conn, conn.profile.clientbound.CONFIGURATION.disconnect_config, w.toBuffer());
      } else if (conn.state === 'PLAY') {
        const w = new PacketWriter().writeNbtTextComponent(reason);
        this.sendPacket(conn, conn.profile.clientbound.PLAY.disconnect_play, w.toBuffer());
      }
    } catch {
      // Ignore write error while disconnecting
    }
    conn.socket.end();
    this.handleSocketClose(conn);
  }

  private handleSocketClose(conn: ClientConnection): void {
    if (conn.closed) return;
    conn.closed = true;
    this.connections.delete(conn.id);

    if (conn.player) {
      const player = conn.player;
      this.players.delete(player.uuid);

      // Remove entity & tab entry for remaining players
      const removeEntities = new PacketWriter().writeVarInt(1).writeVarInt(player.entityId).toBuffer();
      const removeInfo = new PacketWriter().writeVarInt(1).writeUUID(player.uuid).toBuffer();
      for (const other of this.players.values()) {
        this.sendPacket(other.connection, other.connection.profile.clientbound.PLAY.remove_entities, removeEntities);
        this.sendPacket(other.connection, other.connection.profile.clientbound.PLAY.player_info_remove, removeInfo);
      }

      this.log('Quit', `${player.username} left the game`, 'INFO');
      this.emitPlayers();
      void this.pluginManager.emitPlayerQuit(this.toPluginPlayer(player));
    }
  }

  private sendPacket(conn: ClientConnection, packetId: number, payload: Buffer): void {
    if (conn.closed) return;
    try {
      const { framed, compressed, rawLength } = framePacket(packetId, payload, conn.compressionThreshold);
      conn.socket.write(framed);
      this.totalPacketsOut++;

      const packetName = ProtocolMapper.getClientboundName(conn.state, packetId, conn.profile);
      this.recordPacket({
        direction: 'OUTBOUND',
        connectionId: conn.id,
        playerName: conn.username,
        state: conn.state,
        packetId,
        packetName,
        sizeBytes: rawLength,
        compressed,
        summary: `${packetName} (${rawLength}B)`,
        hexPreview: payload.subarray(0, 24).toString('hex'),
      });
    } catch {
      this.handleSocketClose(conn);
    }
  }

  private toPluginPlayer(p: InternalPlayer): PluginPlayer {
    return {
      ...p,
      sendMessage: (msg) => {
        this.sendPlayerChat(p, msg);
        this.log('Chat->Player', `[-> ${p.username}] ${msg}`, 'CHAT');
      },
      teleport: (x, y, z, yaw, pitch) => {
        this.teleportPlayer(p, x, y, z, yaw ?? p.yaw, pitch ?? p.pitch);
      },
      setFlying: (flying) => {
        p.isFlying = flying;
        this.sendPlayerAbilities(p);
        this.emitPlayers();
      },
      setGameMode: (mode) => {
        p.gamemode = mode;
        if (mode === 'creative' || mode === 'spectator') p.isFlying = true;
        this.sendPlayerAbilities(p);
        this.emitPlayers();
      },
      setHealth: (health, food = 20) => {
        p.health = Math.max(0, Math.min(20, health));
        p.food = Math.max(0, Math.min(20, food));
        this.sendPlayerHealth(p);
        this.emitPlayers();
      },
      kick: (reason) => {
        this.kickPlayer(p.username, reason);
      },
    };
  }

  private gameModeToByte(mode: GameMode): number {
    switch (mode) {
      case 'survival':
        return 0;
      case 'creative':
        return 1;
      case 'adventure':
        return 2;
      case 'spectator':
        return 3;
    }
  }

  private findPlayerByName(username: string): InternalPlayer | undefined {
    const lower = username.toLowerCase();
    for (const p of this.players.values()) {
      if (p.username.toLowerCase() === lower) return p;
    }
    return undefined;
  }

  private summarizeInbound(state: ProtocolState, packetId: number, payload: Buffer): string {
    try {
      const r = new PacketReader(payload);
      if (state === 'HANDSHAKE' && packetId === 0x00) {
        const proto = r.readVarInt();
        const addr = r.readString(64);
        const port = r.readUShort();
        const next = r.readVarInt();
        return `proto=${proto} addr=${addr}:${port} next=${next}`;
      }
      if (state === 'LOGIN' && packetId === 0x00) {
        return `username=${r.readString(16)}`;
      }
      if (state === 'PLAY' && packetId === 0x06) {
        return `chat="${r.readString(120)}"`;
      }
      if (state === 'PLAY' && (packetId === 0x04 || packetId === 0x05)) {
        return `cmd="/${r.readString(120)}"`;
      }
    } catch {
      // Fallback
    }
    return `${payload.length} payload bytes`;
  }

  public log(source: string, message: string, level: LogLevel = 'INFO'): void {
    const entry: ConsoleLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      level,
      source,
      message,
    };
    this.consoleLogs.push(entry);
    if (this.consoleLogs.length > MAX_CONSOLE_LOGS) {
      this.consoleLogs.shift();
    }
    this.emit('log', entry);
  }

  private recordPacket(opts: {
    direction: PacketDirection;
    connectionId: string;
    playerName?: string;
    state: ProtocolState;
    packetId: number;
    packetName: string;
    sizeBytes: number;
    compressed: boolean;
    summary: string;
    hexPreview: string;
    error?: string;
  }): void {
    const entry: PacketLogEntry = {
      id: `pkt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      packetHexId: opts.packetId >= 0 ? `0x${opts.packetId.toString(16).padStart(2, '0')}` : '0x??',
      ...opts,
    };
    this.packetLogs.push(entry);
    if (this.packetLogs.length > MAX_PACKET_LOGS) {
      this.packetLogs.shift();
    }
    this.emit('packet', entry);
  }

  private emitPlayers(): void {
    this.emit('players', this.getPlayers());
  }

  private emitMetrics(): void {
    const metrics = this.getMetrics();
    const sample: MetricSample = {
      timestamp: Date.now(),
      tps: metrics.tps,
      mspt: metrics.mspt,
      ramMb: metrics.ramUsedMb,
      cpuPercent: metrics.cpuPercent,
      players: metrics.onlinePlayers,
    };
    this.metricHistory.push(sample);
    if (this.metricHistory.length > MAX_METRIC_HISTORY) {
      this.metricHistory.shift();
    }
    this.emit('metrics', { metrics, sample });
  }

  public getMetrics(): ServerMetrics {
    const bunGlobal = (globalThis as unknown as { Bun?: { version: string } }).Bun;
    return {
      status: this.status,
      runtime: bunGlobal ? 'bun' : 'node',
      runtimeVersion: bunGlobal ? bunGlobal.version : process.version,
      protocolVersion: PRIMARY_PROTOCOL_VERSION,
      minecraftVersion: PRIMARY_MINECRAFT_VERSION,
      supportedVersions: SUPPORTED_RANGE_LABEL,
      port: this.config.port,
      uptimeMs: this.status === 'running' && this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      tps: this.status === 'running' ? this.tps : 0,
      mspt: this.status === 'running' ? this.mspt : 0,
      ramUsedMb: this.ramUsedMb,
      ramTotalMb: this.ramTotalMb,
      cpuPercent: this.cpuPercent,
      onlinePlayers: this.players.size,
      maxPlayers: this.config.maxPlayers,
      totalPacketsIn: this.totalPacketsIn,
      totalPacketsOut: this.totalPacketsOut,
      droppedPackets: this.droppedPackets,
      blockedConnections: this.blockedConnections,
      tickCount: this.tickCount,
      workerActive: Boolean(this.worker),
      errorMessage: this.errorMessage,
    };
  }

  public getConfig(): ServerConfig {
    return this.config;
  }

  public async updateConfig(next: Partial<ServerConfig>): Promise<ServerConfig> {
    const prevPort = this.config.port;
    const prevCompression = this.config.compressionThreshold;
    this.config = saveConfig(next);
    this.world.setWorldType(this.config.worldType);
    this.emit('config', this.config);
    this.log('Settings', `Updated config.json (MOTD, maxPlayers=${this.config.maxPlayers}, viewDistance=${this.config.viewDistance})`, 'INFO');

    if (this.status === 'running' && (prevPort !== this.config.port || prevCompression !== this.config.compressionThreshold)) {
      this.log('Settings', 'Port or compression threshold changed — restarting TCP listener...', 'WARN');
      await this.restart();
    } else {
      this.emitMetrics();
    }
    return this.config;
  }

  public getPlayers(): PlayerInfo[] {
    return Array.from(this.players.values()).map(({ connection: _c, ...rest }) => rest);
  }

  public getBans(): BannedPlayer[] {
    return [...this.bans];
  }

  public getConsoleLogs(): ConsoleLog[] {
    return [...this.consoleLogs];
  }

  public getPacketLogs(): PacketLogEntry[] {
    return [...this.packetLogs];
  }

  public clearPacketLogs(): void {
    this.packetLogs = [];
  }

  public getMetricHistory(): MetricSample[] {
    return [...this.metricHistory];
  }

  public getPlugins(): PluginMetadata[] {
    return this.pluginManager.getMetadataList();
  }
}
