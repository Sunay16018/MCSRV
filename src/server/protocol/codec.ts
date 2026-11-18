import crypto from 'crypto';
import zlib from 'zlib';

// Native Bun Zlib acceleration when running on Bun runtime, with node:zlib fallback
const bunGlobal = (globalThis as unknown as {
  Bun?: {
    deflateSync?: (data: Uint8Array) => Uint8Array;
    inflateSync?: (data: Uint8Array) => Uint8Array;
  };
}).Bun;

export function zlibDeflate(data: Uint8Array): Buffer {
  if (bunGlobal?.deflateSync) {
    return zlib.deflateSync(data);
  }
  return zlib.deflateSync(data);
}

export function zlibInflate(data: Uint8Array): Buffer {
  return zlib.inflateSync(data);
}

export class PacketCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PacketCodecError';
  }
}

export class PacketReader {
  private offset = 0;
  public readonly buffer: Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  private ensure(bytes: number): void {
    if (this.offset + bytes > this.buffer.length) {
      throw new PacketCodecError(`Buffer underflow: needed ${bytes} bytes at offset ${this.offset}, remaining ${this.remaining}`);
    }
  }

  readByte(): number {
    this.ensure(1);
    const val = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readUByte(): number {
    this.ensure(1);
    const val = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readBoolean(): boolean {
    return this.readUByte() !== 0;
  }

  readShort(): number {
    this.ensure(2);
    const val = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  readUShort(): number {
    this.ensure(2);
    const val = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  readInt(): number {
    this.ensure(4);
    const val = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  readLong(): bigint {
    this.ensure(8);
    const val = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return val;
  }

  readFloat(): number {
    this.ensure(4);
    const val = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return val;
  }

  readDouble(): number {
    this.ensure(8);
    const val = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return val;
  }

  readVarInt(): number {
    let numRead = 0;
    let result = 0;
    let read: number;
    do {
      if (this.offset >= this.buffer.length) {
        throw new PacketCodecError('Unexpected EOF while reading VarInt');
      }
      read = this.buffer[this.offset++];
      const value = read & 0b01111111;
      result |= value << (7 * numRead);
      numRead++;
      if (numRead > 5) {
        throw new PacketCodecError('VarInt exceeds maximum 5 bytes');
      }
    } while ((read & 0b10000000) !== 0);
    return result | 0;
  }

  readString(maxLength = 32767): string {
    const len = this.readVarInt();
    if (len < 0 || len > maxLength * 4) {
      throw new PacketCodecError(`Invalid string byte length: ${len}`);
    }
    this.ensure(len);
    const str = this.buffer.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return str;
  }

  readUUID(): string {
    this.ensure(16);
    const hex = this.buffer.subarray(this.offset, this.offset + 16).toString('hex');
    this.offset += 16;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  readPosition(): { x: number; y: number; z: number } {
    const val = this.readLong();
    let x = Number(val >> 38n);
    let y = Number((val << 52n) >> 52n);
    let z = Number((val << 26n) >> 38n);
    if (x >= 1 << 25) x -= 1 << 26;
    if (y >= 1 << 11) y -= 1 << 12;
    if (z >= 1 << 25) z -= 1 << 26;
    return { x, y, z };
  }

  readBytes(length: number): Buffer {
    if (length < 0) {
      throw new PacketCodecError(`Negative byte length: ${length}`);
    }
    this.ensure(length);
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

export class PacketWriter {
  private chunks: Buffer[] = [];
  private totalLen = 0;

  writeByte(val: number): this {
    const buf = Buffer.allocUnsafe(1);
    buf.writeInt8(val, 0);
    this.chunks.push(buf);
    this.totalLen += 1;
    return this;
  }

  writeUByte(val: number): this {
    const buf = Buffer.allocUnsafe(1);
    buf.writeUInt8(val & 0xff, 0);
    this.chunks.push(buf);
    this.totalLen += 1;
    return this;
  }

  writeBoolean(val: boolean): this {
    return this.writeUByte(val ? 1 : 0);
  }

  writeShort(val: number): this {
    const buf = Buffer.allocUnsafe(2);
    buf.writeInt16BE(val, 0);
    this.chunks.push(buf);
    this.totalLen += 2;
    return this;
  }

  writeUShort(val: number): this {
    const buf = Buffer.allocUnsafe(2);
    buf.writeUInt16BE(val & 0xffff, 0);
    this.chunks.push(buf);
    this.totalLen += 2;
    return this;
  }

  writeInt(val: number): this {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32BE(val, 0);
    this.chunks.push(buf);
    this.totalLen += 4;
    return this;
  }

  writeLong(val: bigint | number): this {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigInt64BE(typeof val === 'bigint' ? val : BigInt(val), 0);
    this.chunks.push(buf);
    this.totalLen += 8;
    return this;
  }

  writeFloat(val: number): this {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(val, 0);
    this.chunks.push(buf);
    this.totalLen += 4;
    return this;
  }

  writeDouble(val: number): this {
    const buf = Buffer.allocUnsafe(8);
    buf.writeDoubleBE(val, 0);
    this.chunks.push(buf);
    this.totalLen += 8;
    return this;
  }

  writeVarInt(value: number): this {
    let val = value >>> 0;
    const out: number[] = [];
    while (true) {
      if ((val & ~0x7f) === 0) {
        out.push(val);
        break;
      }
      out.push((val & 0x7f) | 0x80);
      val >>>= 7;
    }
    const buf = Buffer.from(out);
    this.chunks.push(buf);
    this.totalLen += buf.length;
    return this;
  }

  writeVarLong(value: bigint | number): this {
    let val = BigInt.asUintN(64, typeof value === 'bigint' ? value : BigInt(value));
    const out: number[] = [];
    while (true) {
      if ((val & ~0x7fn) === 0n) {
        out.push(Number(val));
        break;
      }
      out.push(Number(val & 0x7fn) | 0x80);
      val >>= 7n;
    }
    const buf = Buffer.from(out);
    this.chunks.push(buf);
    this.totalLen += buf.length;
    return this;
  }

  writeString(str: string): this {
    const strBuf = Buffer.from(str, 'utf8');
    this.writeVarInt(strBuf.length);
    this.chunks.push(strBuf);
    this.totalLen += strBuf.length;
    return this;
  }

  writeUUID(uuid: string): this {
    const clean = uuid.replace(/-/g, '');
    const buf = Buffer.from(clean.padEnd(32, '0').slice(0, 32), 'hex');
    this.chunks.push(buf);
    this.totalLen += 16;
    return this;
  }

  writePosition(x: number, y: number, z: number): this {
    const bx = BigInt(Math.floor(x)) & 0x3ffffffn;
    const bz = BigInt(Math.floor(z)) & 0x3ffffffn;
    const by = BigInt(Math.floor(y)) & 0xfffn;
    const packed = (bx << 38n) | (bz << 12n) | by;
    return this.writeLong(packed);
  }

  writeBytes(buf: Buffer | Uint8Array): this {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.chunks.push(b);
    this.totalLen += b.length;
    return this;
  }

  private writeNbtTagName(name: string): void {
    const nameBuf = Buffer.from(name, 'utf8');
    this.writeUShort(nameBuf.length);
    this.writeBytes(nameBuf);
  }

  // Network NBT (root nameless Compound tag: tagType=10, then entries, then tagEnd=0)
  writeNbtTextComponent(text: string): this {
    this.writeUByte(10); // TAG_Compound (nameless in network NBT 1.20.2+)
    this.writeNbtString('text', text);
    this.writeUByte(0); // TAG_End
    return this;
  }

  writeNbtString(name: string, value: string): this {
    this.writeUByte(8); // TAG_String
    this.writeNbtTagName(name);
    const valBuf = Buffer.from(value, 'utf8');
    this.writeUShort(valBuf.length);
    this.writeBytes(valBuf);
    return this;
  }

  writeNbtAnonymousString(value: string): this {
    const valBuf = Buffer.from(value, 'utf8');
    this.writeUShort(valBuf.length);
    this.writeBytes(valBuf);
    return this;
  }

  writeNbtInt(name: string, value: number): this {
    this.writeUByte(3); // TAG_Int
    this.writeNbtTagName(name);
    this.writeInt(value);
    return this;
  }

  writeNbtFloat(name: string, value: number): this {
    this.writeUByte(5); // TAG_Float
    this.writeNbtTagName(name);
    this.writeFloat(value);
    return this;
  }

  writeNbtDouble(name: string, value: number): this {
    this.writeUByte(6); // TAG_Double
    this.writeNbtTagName(name);
    this.writeDouble(value);
    return this;
  }

  writeNbtByte(name: string, value: number): this {
    this.writeUByte(1); // TAG_Byte
    this.writeNbtTagName(name);
    this.writeByte(value);
    return this;
  }

  writeNbtBoolean(name: string, value: boolean): this {
    return this.writeNbtByte(name, value ? 1 : 0);
  }

  writeNbtListStart(name: string, elementType: number, length: number): this {
    this.writeUByte(9); // TAG_List
    this.writeNbtTagName(name);
    this.writeUByte(elementType);
    this.writeInt(length);
    return this;
  }

  writeNbtIntArray(name: string, values: number[]): this {
    this.writeUByte(11); // TAG_Int_Array
    this.writeNbtTagName(name);
    this.writeInt(values.length);
    for (const v of values) {
      this.writeInt(v);
    }
    return this;
  }

  writeNbtLongArray(name: string, values: bigint[]): this {
    this.writeUByte(12); // TAG_Long_Array
    this.writeNbtTagName(name);
    this.writeInt(values.length);
    for (const v of values) {
      this.writeLong(v);
    }
    return this;
  }

  writeNbtCompoundStart(name?: string): this {
    this.writeUByte(10); // TAG_Compound
    if (name !== undefined) {
      this.writeNbtTagName(name);
    }
    return this;
  }

  writeNbtEnd(): this {
    return this.writeUByte(0);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.totalLen);
  }
}

export function encodeVarInt(value: number): Buffer {
  const w = new PacketWriter();
  w.writeVarInt(value);
  return w.toBuffer();
}

export function tryReadVarInt(buffer: Buffer, startOffset = 0): { value: number; bytesRead: number } | null {
  let numRead = 0;
  let result = 0;
  while (startOffset + numRead < buffer.length) {
    const read = buffer[startOffset + numRead];
    result |= (read & 0x7f) << (7 * numRead);
    numRead++;
    if (numRead > 5) {
      throw new PacketCodecError('Malformed packet length VarInt (> 5 bytes)');
    }
    if ((read & 0x80) === 0) {
      return { value: result | 0, bytesRead: numRead };
    }
  }
  return null;
}

export function framePacket(
  packetId: number,
  payload: Buffer,
  compressionThreshold: number
): { framed: Buffer; compressed: boolean; rawLength: number } {
  const idBuf = encodeVarInt(packetId);
  const rawPacket = Buffer.concat([idBuf, payload]);

  if (compressionThreshold < 0) {
    const lenPrefix = encodeVarInt(rawPacket.length);
    return {
      framed: Buffer.concat([lenPrefix, rawPacket]),
      compressed: false,
      rawLength: rawPacket.length,
    };
  }

  if (rawPacket.length >= compressionThreshold) {
    const compressedPayload = zlibDeflate(rawPacket);
    const dataLengthBuf = encodeVarInt(rawPacket.length);
    const inner = Buffer.concat([dataLengthBuf, compressedPayload]);
    const packetLenBuf = encodeVarInt(inner.length);
    return {
      framed: Buffer.concat([packetLenBuf, inner]),
      compressed: true,
      rawLength: rawPacket.length,
    };
  } else {
    const dataLengthBuf = encodeVarInt(0);
    const inner = Buffer.concat([dataLengthBuf, rawPacket]);
    const packetLenBuf = encodeVarInt(inner.length);
    return {
      framed: Buffer.concat([packetLenBuf, inner]),
      compressed: false,
      rawLength: rawPacket.length,
    };
  }
}

export interface UnframedPacket {
  packetId: number;
  payload: Buffer;
  rawSize: number;
  compressed: boolean;
}

export function extractOnePacketFromBuffer(
  accumulator: Buffer,
  compressionThreshold: number,
  maxPacketSize: number
): { packet: UnframedPacket | null; remaining: Buffer } {
  if (accumulator.length === 0) {
    return { packet: null, remaining: accumulator };
  }

  if (accumulator[0] === 0xfe) {
    throw new PacketCodecError('Legacy 1.6 Server List Ping (0xFE) dropped by Protocol 777 shield');
  }

  const lenHeader = tryReadVarInt(accumulator, 0);
  if (!lenHeader) {
    return { packet: null, remaining: accumulator };
  }

  const packetLen = lenHeader.value;
  if (packetLen <= 0 || packetLen > maxPacketSize) {
    throw new PacketCodecError(`Packet length out of bounds: ${packetLen} bytes (max ${maxPacketSize})`);
  }

  const bodyStart = lenHeader.bytesRead;
  const bodyEnd = bodyStart + packetLen;
  if (bodyEnd > accumulator.length) {
    return { packet: null, remaining: accumulator };
  }

  const body = accumulator.subarray(bodyStart, bodyEnd);
  const remaining = accumulator.subarray(bodyEnd);

  let packetData: Buffer;
  let compressed = false;

  if (compressionThreshold >= 0) {
    const reader = new PacketReader(body);
    const dataLength = reader.readVarInt();
    if (dataLength === 0) {
      packetData = body.subarray(reader.position);
    } else {
      if (dataLength > maxPacketSize) {
        throw new PacketCodecError(`Uncompressed packet length exceeds limit: ${dataLength}`);
      }
      const compressedSlice = body.subarray(reader.position);
      try {
        packetData = zlibInflate(compressedSlice);
      } catch (err) {
        throw new PacketCodecError(`Zlib decompression failed: ${(err as Error).message}`);
      }
      if (packetData.length !== dataLength) {
        throw new PacketCodecError(`Zlib length mismatch: expected ${dataLength}, got ${packetData.length}`);
      }
      compressed = true;
    }
  } else {
    packetData = body;
  }

  const innerReader = new PacketReader(packetData);
  const packetId = innerReader.readVarInt();
  const payload = packetData.subarray(innerReader.position);

  return {
    packet: {
      packetId,
      payload,
      rawSize: packetLen,
      compressed,
    },
    remaining,
  };
}

export function extractPacketsFromBuffer(
  accumulator: Buffer,
  compressionThreshold: number,
  maxPacketSize: number
): { packets: UnframedPacket[]; remaining: Buffer } {
  const packets: UnframedPacket[] = [];
  let current = accumulator;

  while (current.length > 0) {
    const { packet, remaining } = extractOnePacketFromBuffer(current, compressionThreshold, maxPacketSize);
    if (!packet) break;
    packets.push(packet);
    current = remaining;
  }

  return { packets, remaining: current };
}

export function offlineUuid(username: string): string {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // Version 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // IETF variant
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Generate a deterministic crisp 64x64 PNG server icon (obsidian + emerald core emblem)
let cachedFavicon: string | null = null;

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export function getServerFavicon(): string {
  if (cachedFavicon) return cachedFavicon;
  const width = 64;
  const height = 64;
  const raw = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = Math.abs(x - 31.5);
      const dy = Math.abs(y - 31.5);
      const dist = Math.max(dx, dy);

      let r = 13;
      let g = 17;
      let b = 26;
      if (dist < 28 && dist >= 25) {
        r = 16; g = 185; b = 129;
      } else if (dx + dy < 18) {
        r = 16; g = 185; b = 129;
        if (dx + dy < 9) {
          r = 110; g = 231; b = 183;
        }
      } else if (dist < 25) {
        r = 22; g = 29; b = 43;
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlibDeflate(raw);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  cachedFavicon = `data:image/png;base64,${png.toString('base64')}`;
  return cachedFavicon;
}
