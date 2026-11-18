import net from 'net';
import {
  extractOnePacketFromBuffer,
  framePacket,
  PacketReader,
  PacketWriter,
} from './codec.ts';
import { PRIMARY_PROTOCOL_VERSION } from './mapper.ts';

export interface StatusProbeResult {
  motd: string;
  versionName: string;
  protocol: number;
  onlinePlayers: number;
  maxPlayers: number;
  rttMs: number;
  faviconPresent: boolean;
}

interface ActiveBotSession {
  username: string;
  socket: net.Socket;
  compressionThreshold: number;
  state: 'HANDSHAKE' | 'LOGIN' | 'CONFIGURATION' | 'PLAY';
  buffer: Buffer;
}

const activeBots = new Map<string, ActiveBotSession>();

// Opens a real TCP socket to the Minecraft 26.3 server and performs Status + Ping-Pong
export async function runRealStatusProbe(port: number): Promise<StatusProbeResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let buffer: Buffer = Buffer.alloc(0);
    let pingSentAt = 0;
    let statusPayload: {
      version: { name: string; protocol: number };
      players: { max: number; online: number };
      description: { text: string };
      favicon?: string;
    } | null = null;

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Status probe timed out after 3000ms'));
    }, 3000);

    socket.on('connect', () => {
      const hs = new PacketWriter()
        .writeVarInt(PRIMARY_PROTOCOL_VERSION)
        .writeString('127.0.0.1')
        .writeUShort(port)
        .writeVarInt(1)
        .toBuffer();
      socket.write(framePacket(0x00, hs, -1).framed);
      socket.write(framePacket(0x00, Buffer.alloc(0), -1).framed);
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        const { packet: pkt, remaining } = extractOnePacketFromBuffer(buffer, -1, 2097152);
        buffer = remaining;
        if (!pkt) break;
        const reader = new PacketReader(pkt.payload);
        if (pkt.packetId === 0x00) {
          statusPayload = JSON.parse(reader.readString());
          pingSentAt = performance.now();
          const pingBuf = new PacketWriter().writeLong(BigInt(Date.now())).toBuffer();
          socket.write(framePacket(0x01, pingBuf, -1).framed);
        } else if (pkt.packetId === 0x01 && statusPayload) {
          const rttMs = Math.max(0.1, Number((performance.now() - pingSentAt).toFixed(2)));
          clearTimeout(timeout);
          socket.end();
          resolve({
            motd: statusPayload.description?.text ?? '',
            versionName: statusPayload.version?.name ?? '26.3',
            protocol: statusPayload.version?.protocol ?? PRIMARY_PROTOCOL_VERSION,
            onlinePlayers: statusPayload.players?.online ?? 0,
            maxPlayers: statusPayload.players?.max ?? 0,
            rttMs,
            faviconPresent: Boolean(statusPayload.favicon),
          });
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Opens a genuine TCP connection speaking Protocol 777 through Login -> Config -> Play
export async function spawnRealProtocolBot(port: number, username: string): Promise<string> {
  if (activeBots.has(username)) {
    throw new Error(`Test client "${username}" is already connected`);
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const session: ActiveBotSession = {
      username,
      socket,
      compressionThreshold: -1,
      state: 'HANDSHAKE',
      buffer: Buffer.alloc(0) as Buffer,
    };

    const timeout = setTimeout(() => {
      socket.destroy();
      activeBots.delete(username);
      reject(new Error('Bot login handshake timed out'));
    }, 4000);

    socket.on('connect', () => {
      const hs = new PacketWriter()
        .writeVarInt(PRIMARY_PROTOCOL_VERSION)
        .writeString('aetherprobe.local')
        .writeUShort(port)
        .writeVarInt(2)
        .toBuffer();
      socket.write(framePacket(0x00, hs, -1).framed);

      session.state = 'LOGIN';
      const loginStart = new PacketWriter()
        .writeString(username)
        .writeUUID('00000000-0000-0000-0000-000000000000')
        .toBuffer();
      socket.write(framePacket(0x00, loginStart, -1).framed);
    });

    socket.on('data', (chunk) => {
      try {
        session.buffer = Buffer.concat([session.buffer, chunk]);
        while (session.buffer.length > 0) {
          const { packet: pkt, remaining } = extractOnePacketFromBuffer(
            session.buffer,
            session.compressionThreshold,
            2097152
          );
          session.buffer = remaining;
          if (!pkt) break;

          const reader = new PacketReader(pkt.payload);

          if (session.state === 'LOGIN') {
            if (pkt.packetId === 0x03) {
              session.compressionThreshold = reader.readVarInt();
            } else if (pkt.packetId === 0x02) {
              // Login Success -> send Login Acknowledged (0x03)
              socket.write(framePacket(0x03, Buffer.alloc(0), session.compressionThreshold).framed);
              session.state = 'CONFIGURATION';
              const clientInfo = new PacketWriter().writeString('en_US').writeByte(6).toBuffer();
              socket.write(framePacket(0x00, clientInfo, session.compressionThreshold).framed);
            } else if (pkt.packetId === 0x00) {
              clearTimeout(timeout);
              socket.destroy();
              reject(new Error(`Disconnected during login: ${reader.readString()}`));
              return;
            }
          } else if (session.state === 'CONFIGURATION') {
            if (pkt.packetId === 0x0e) {
              const ackKnown = new PacketWriter()
                .writeVarInt(1)
                .writeString('minecraft')
                .writeString('core')
                .writeString('26.3')
                .toBuffer();
              socket.write(framePacket(0x07, ackKnown, session.compressionThreshold).framed);
            } else if (pkt.packetId === 0x03) {
              socket.write(framePacket(0x03, Buffer.alloc(0), session.compressionThreshold).framed);
              session.state = 'PLAY';
              activeBots.set(username, session);
              clearTimeout(timeout);
              resolve(username);
            }
          } else if (session.state === 'PLAY') {
            if (pkt.packetId === 0x26) {
              // Reply to Keep Alive
              const keepId = reader.readLong();
              const pong = new PacketWriter().writeLong(keepId).toBuffer();
              socket.write(framePacket(0x18, pong, session.compressionThreshold).framed);
            }
          }
        }
      } catch {
        // Ignore parser error in bot probe
      }
    });

    socket.on('close', () => {
      activeBots.delete(username);
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      activeBots.delete(username);
      reject(err);
    });
  });
}

export function sendBotChatOrCommand(username: string, message: string): boolean {
  const session = activeBots.get(username);
  if (!session || session.state !== 'PLAY') return false;

  if (message.startsWith('/')) {
    const cmdPayload = new PacketWriter().writeString(message.slice(1)).toBuffer();
    session.socket.write(framePacket(0x04, cmdPayload, session.compressionThreshold).framed);
  } else {
    const chatPayload = new PacketWriter().writeString(message).toBuffer();
    session.socket.write(framePacket(0x06, chatPayload, session.compressionThreshold).framed);
  }
  return true;
}

export function moveBotStep(username: string, dx: number, dy: number, dz: number, curX: number, curY: number, curZ: number): boolean {
  const session = activeBots.get(username);
  if (!session || session.state !== 'PLAY') return false;
  const w = new PacketWriter()
    .writeDouble(curX + dx)
    .writeDouble(curY + dy)
    .writeDouble(curZ + dz)
    .toBuffer();
  session.socket.write(framePacket(0x1a, w, session.compressionThreshold).framed);
  return true;
}

export function disconnectBot(username: string): boolean {
  const session = activeBots.get(username);
  if (!session) return false;
  session.socket.end();
  activeBots.delete(username);
  return true;
}

// Sends an intentionally malformed packet over TCP to verify the Crash-Proof Shield
export async function sendMalformedShieldTest(port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.on('connect', () => {
      // Garbage oversized VarInt + invalid Zlib header
      const corrupted = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x7f, 0xde, 0xad, 0xbe, 0xef]);
      socket.write(corrupted);
      setTimeout(() => {
        socket.end();
        resolve();
      }, 150);
    });
    socket.on('error', () => resolve());
  });
}
