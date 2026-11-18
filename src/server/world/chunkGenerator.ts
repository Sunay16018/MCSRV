import { PacketWriter } from '../protocol/codec.ts';

// Minimal Superflat & Void world block state registry
// Standard block state IDs:
// 0 = air, 79 = bedrock, 10 = dirt, 9 = grass_block (snowy=false), 1 = stone, 14 = oak_planks
export const BLOCK_IDS = {
  AIR: 0,
  STONE: 1,
  GRASS_BLOCK: 9,
  DIRT: 10,
  OAK_PLANKS: 14,
  BEDROCK: 79,
} as const;

export class WorldEngine {
  private blocks = new Map<string, number>();
  private worldType: 'superflat' | 'void' = 'superflat';

  setWorldType(type: 'superflat' | 'void'): void {
    this.worldType = type;
  }

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  getBlock(x: number, y: number, z: number): number {
    const k = this.key(x, y, z);
    const custom = this.blocks.get(k);
    if (custom !== undefined) return custom;

    if (this.worldType === 'void') {
      // Small obsidian/stone spawn platform around (0,63,0) in void mode so players don't fall
      if (y === 63 && Math.abs(x) <= 3 && Math.abs(z) <= 3) return BLOCK_IDS.STONE;
      return BLOCK_IDS.AIR;
    }

    // Superflat: bedrock at 0, stone 1..59, dirt 60..62, grass at 63
    if (y === 0) return BLOCK_IDS.BEDROCK;
    if (y >= 1 && y <= 59) return BLOCK_IDS.STONE;
    if (y >= 60 && y <= 62) return BLOCK_IDS.DIRT;
    if (y === 63) return BLOCK_IDS.GRASS_BLOCK;
    return BLOCK_IDS.AIR;
  }

  setBlock(x: number, y: number, z: number, stateId: number): void {
    this.blocks.set(this.key(x, y, z), stateId);
  }

  getModifiedCount(): number {
    return this.blocks.size;
  }

  // Builds a valid Minecraft Level Chunk With Light packet payload (24 sections: y=-64..319)
  buildChunkPacketPayload(chunkX: number, chunkZ: number): Buffer {
    const w = new PacketWriter();
    w.writeInt(chunkX);
    w.writeInt(chunkZ);

    // Heightmaps (Network NBT: MOTION_BLOCKING long array)
    const heightmapLongs = new Array<bigint>(37).fill(0n);
    w.writeNbtCompoundStart();
    w.writeNbtLongArray('MOTION_BLOCKING', heightmapLongs);
    w.writeNbtEnd();

    // Build 24 sections (index 0 = y -64..-49 ... index 7 = y 48..63)
    const chunkData = new PacketWriter();
    for (let sectionIdx = 0; sectionIdx < 24; sectionIdx++) {
      const minY = -64 + sectionIdx * 16;
      const isFlatSurfaceSection = this.worldType === 'superflat' && minY === 48; // covers y 48..63
      const isSolidStoneSection = this.worldType === 'superflat' && (minY === 0 || minY === 16 || minY === 32);

      if (!isFlatSurfaceSection && !isSolidStoneSection) {
        // Empty air section (Single-valued palette: blockCount = 0)
        chunkData.writeShort(0);
        chunkData.writeUByte(0); // bitsPerEntry = 0 (single value)
        chunkData.writeVarInt(BLOCK_IDS.AIR);
        chunkData.writeVarInt(0); // data array length = 0
      } else if (isSolidStoneSection) {
        // Solid stone section (4096 blocks)
        chunkData.writeShort(4096);
        chunkData.writeUByte(0); // single-valued palette
        chunkData.writeVarInt(BLOCK_IDS.STONE);
        chunkData.writeVarInt(0);
      } else {
        // Surface section y=48..63: y=48..59 stone, 60..62 dirt, 63 grass (4096 blocks)
        chunkData.writeShort(4096);
        // Use single-valued grass or indirect 4-bit palette
        chunkData.writeUByte(4); // 4 bits per entry (16 entries per long, 256 longs)
        chunkData.writeVarInt(3); // palette length: [stone, dirt, grass]
        chunkData.writeVarInt(BLOCK_IDS.STONE);
        chunkData.writeVarInt(BLOCK_IDS.DIRT);
        chunkData.writeVarInt(BLOCK_IDS.GRASS_BLOCK);

        // 4096 entries at 4 bits/entry = 256 longs (16 entries per long)
        chunkData.writeVarInt(256);
        for (let yOffset = 0; yOffset < 16; yOffset++) {
          const paletteIdx = yOffset === 15 ? 2 : yOffset >= 12 ? 1 : 0;
          // 16x16 = 256 blocks per layer -> 16 longs per Y layer
          let packed = 0n;
          for (let i = 0; i < 16; i++) {
            packed |= BigInt(paletteIdx) << BigInt(i * 4);
          }
          for (let l = 0; l < 16; l++) {
            chunkData.writeLong(packed);
          }
        }
      }

      // Biomes container (single-valued plains = 0)
      chunkData.writeUByte(0);
      chunkData.writeVarInt(0);
      chunkData.writeVarInt(0);
    }

    const sectionBytes = chunkData.toBuffer();
    w.writeVarInt(sectionBytes.length);
    w.writeBytes(sectionBytes);

    // Block Entities (0)
    w.writeVarInt(0);

    // Light data (Sky Light Mask, Block Light Mask, Empty masks, Sky/Block arrays)
    // BitSet (long count = 1, mask = 0 for simple minimal valid light frame)
    w.writeVarInt(0); // skyLightMask BitSet len
    w.writeVarInt(0); // blockLightMask BitSet len
    w.writeVarInt(0); // emptySkyLightMask BitSet len
    w.writeVarInt(0); // emptyBlockLightMask BitSet len
    w.writeVarInt(0); // skyLightArrays count
    w.writeVarInt(0); // blockLightArrays count

    return w.toBuffer();
  }
}
