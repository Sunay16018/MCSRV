import { PacketWriter } from '../protocol/codec.ts';

// Canonical Vanilla block state IDs (1.21.2 - 26.3); resolved dynamically for 1.21 (767)
export const BLOCK_IDS = {
  AIR: 0,
  STONE: 1,
  GRASS_BLOCK: 9,
  DIRT: 10,
  COBBLESTONE: 14,
  OAK_PLANKS: 15,
  BEDROCK: 85,
  WATER: 86,
  GLASS: 562,
} as const;

export function resolveBlockStateForProtocol(stateId: number, protocolVersion: number): number {
  if (protocolVersion <= 767) {
    if (stateId === BLOCK_IDS.BEDROCK) return 79;
    if (stateId === BLOCK_IDS.WATER) return 80;
    if (stateId === BLOCK_IDS.GLASS) return 519;
  }
  return stateId;
}

const FULL_BRIGHT_LIGHT_SECTION = Buffer.alloc(2048, 0xff);

// In 1.21 - 1.21.4 (proto <= 769), PalettedContainer writes `dataArrayLength` VarInt.
// In 1.21.5+ (proto >= 770), PalettedContainer OMITS `dataArrayLength` VarInt completely.
export class WorldEngine {
  private blocks = new Map<string, number>();
  private worldType: 'superflat' | 'void' = 'superflat';
  private worldAge = 0n;
  private timeOfDay = 6000n; // Noon daylight by default

  setWorldType(type: 'superflat' | 'void'): void {
    this.worldType = type;
  }

  getWorldType(): 'superflat' | 'void' {
    return this.worldType;
  }

  advanceTick(): void {
    this.worldAge += 1n;
    this.timeOfDay = (this.timeOfDay + 1n) % 24000n;
  }

  getWorldAge(): bigint {
    return this.worldAge;
  }

  getTimeOfDay(): bigint {
    return this.timeOfDay;
  }

  setTimeOfDay(ticks: bigint): void {
    const mod = ticks % 24000n;
    this.timeOfDay = mod < 0n ? mod + 24000n : mod;
  }

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  getBlock(x: number, y: number, z: number): number {
    const k = this.key(x, y, z);
    const custom = this.blocks.get(k);
    if (custom !== undefined) return custom;

    if (this.worldType === 'void') {
      if (y === 63 && Math.abs(x) <= 4 && Math.abs(z) <= 4) {
        return Math.abs(x) === 4 || Math.abs(z) === 4 ? BLOCK_IDS.OAK_PLANKS : BLOCK_IDS.STONE;
      }
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
    if (y < -64 || y > 319) return;
    this.blocks.set(this.key(x, y, z), stateId);
  }

  getModifiedCount(): number {
    return this.blocks.size;
  }

  /**
   * Builds a valid Minecraft Level Chunk With Light packet payload (24 sections: y=-64..319).
   * - Protocols 767-769 (1.21 - 1.21.4): NBT Heightmaps + PalettedContainer dataArrayLength VarInt
   * - Protocols 770-777 (1.21.5 - 26.3): Flat Heightmap arrays + NO PalettedContainer dataArrayLength VarInt
   */
  buildChunkPacketPayload(
    chunkX: number,
    chunkZ: number,
    usesFlatHeightmaps = true,
    omitPaletteDataLength = usesFlatHeightmaps,
    protocolVersion = 777
  ): Buffer {
    const w = new PacketWriter();
    w.writeInt(chunkX);
    w.writeInt(chunkZ);

    // 256 columns, 9 bits per height value, 7 entries per long -> ceil(256 / 7) = 37 longs
    const heightVal = this.worldType === 'superflat' ? 128n : 0n;
    let packedHeightLong = 0n;
    for (let i = 0; i < 7; i++) {
      packedHeightLong |= heightVal << BigInt(i * 9);
    }
    const heightmapLongs = new Array<bigint>(37).fill(packedHeightLong);

    if (usesFlatHeightmaps) {
      w.writeVarInt(1); // 1 heightmap entry
      w.writeVarInt(4); // 4 = MOTION_BLOCKING
      w.writeVarInt(heightmapLongs.length);
      for (const l of heightmapLongs) {
        w.writeLong(l);
      }
    } else {
      w.writeNbtCompoundStart();
      w.writeNbtLongArray('MOTION_BLOCKING', heightmapLongs);
      w.writeNbtEnd();
    }

    const baseX = chunkX * 16;
    const baseZ = chunkZ * 16;

    // Build 24 sections (index 0 = y -64..-49 ... index 7 = y 48..63)
    const chunkData = new PacketWriter();
    for (let sectionIdx = 0; sectionIdx < 24; sectionIdx++) {
      const minY = -64 + sectionIdx * 16;
      let hasCustomInSection = false;
      if (this.blocks.size > 0) {
        for (const k of this.blocks.keys()) {
          const [bx, by, bz] = k.split(',').map(Number);
          if (
            bx >= baseX &&
            bx < baseX + 16 &&
            bz >= baseZ &&
            bz < baseZ + 16 &&
            by >= minY &&
            by < minY + 16
          ) {
            hasCustomInSection = true;
            break;
          }
        }
      }

      const isFlatSurfaceSection = this.worldType === 'superflat' && minY === 48; // y=48..63
      const isFlatBedrockSection = this.worldType === 'superflat' && minY === 0; // y=0 bedrock, y=1..15 stone
      const isSolidStoneSection = this.worldType === 'superflat' && (minY === 16 || minY === 32);
      const isVoidPlatformSection = this.worldType === 'void' && minY === 48 && chunkX === 0 && chunkZ === 0;

      if (hasCustomInSection || isFlatBedrockSection) {
        // Encode general 4096-block section with dynamic palette
        const palette: number[] = [];
        const paletteIndex = new Map<number, number>();
        const grid = new Uint16Array(4096);
        let nonAirCount = 0;

        for (let yOff = 0; yOff < 16; yOff++) {
          for (let zOff = 0; zOff < 16; zOff++) {
            for (let xOff = 0; xOff < 16; xOff++) {
              const rawState = this.getBlock(baseX + xOff, minY + yOff, baseZ + zOff);
              const state = resolveBlockStateForProtocol(rawState, protocolVersion);
              if (state !== BLOCK_IDS.AIR) nonAirCount++;
              let pIdx = paletteIndex.get(state);
              if (pIdx === undefined) {
                pIdx = palette.length;
                palette.push(state);
                paletteIndex.set(state, pIdx);
              }
              grid[(yOff << 8) | (zOff << 4) | xOff] = pIdx;
            }
          }
        }

        if (palette.length === 1) {
          chunkData.writeShort(nonAirCount);
          chunkData.writeUByte(0);
          chunkData.writeVarInt(palette[0]);
          if (!omitPaletteDataLength) chunkData.writeVarInt(0);
        } else {
          const bitsPerEntry = Math.max(4, Math.ceil(Math.log2(palette.length)));
          const entriesPerLong = Math.floor(64 / bitsPerEntry);
          const longCount = Math.ceil(4096 / entriesPerLong);

          chunkData.writeShort(nonAirCount);
          chunkData.writeUByte(bitsPerEntry);
          chunkData.writeVarInt(palette.length);
          for (const st of palette) chunkData.writeVarInt(st);
          if (!omitPaletteDataLength) chunkData.writeVarInt(longCount);

          for (let l = 0; l < longCount; l++) {
            let packed = 0n;
            const baseIdx = l * entriesPerLong;
            for (let e = 0; e < entriesPerLong && baseIdx + e < 4096; e++) {
              packed |= BigInt(grid[baseIdx + e]) << BigInt(e * bitsPerEntry);
            }
            chunkData.writeLong(BigInt.asIntN(64, packed));
          }
        }
      } else if (isFlatSurfaceSection) {
        // Surface section y=48..63: y=48..59 stone, 60..62 dirt, 63 grass (4096 blocks)
        chunkData.writeShort(4096);
        chunkData.writeUByte(4); // 4 bits per entry
        chunkData.writeVarInt(3); // palette length: [stone, dirt, grass]
        chunkData.writeVarInt(BLOCK_IDS.STONE);
        chunkData.writeVarInt(BLOCK_IDS.DIRT);
        chunkData.writeVarInt(BLOCK_IDS.GRASS_BLOCK);

        if (!omitPaletteDataLength) {
          chunkData.writeVarInt(256); // Removed in 1.21.5 (Proto 770+)
        }

        for (let yOffset = 0; yOffset < 16; yOffset++) {
          const paletteIdx = yOffset === 15 ? 2 : yOffset >= 12 ? 1 : 0;
          let packed = 0n;
          for (let i = 0; i < 16; i++) {
            packed |= BigInt(paletteIdx) << BigInt(i * 4);
          }
          const signedLong = BigInt.asIntN(64, packed);
          for (let l = 0; l < 16; l++) {
            chunkData.writeLong(signedLong);
          }
        }
      } else if (isSolidStoneSection) {
        chunkData.writeShort(4096);
        chunkData.writeUByte(0); // single-valued palette
        chunkData.writeVarInt(BLOCK_IDS.STONE);
        if (!omitPaletteDataLength) {
          chunkData.writeVarInt(0);
        }
      } else if (isVoidPlatformSection) {
        // Spawn chunk (0,0) in void mode has a 5x5 stone/oak platform at y=63 (yOffset=15)
        chunkData.writeShort(25);
        chunkData.writeUByte(4);
        chunkData.writeVarInt(3);
        chunkData.writeVarInt(BLOCK_IDS.AIR);
        chunkData.writeVarInt(BLOCK_IDS.STONE);
        chunkData.writeVarInt(BLOCK_IDS.OAK_PLANKS);
        if (!omitPaletteDataLength) {
          chunkData.writeVarInt(256);
        }

        for (let yOffset = 0; yOffset < 16; yOffset++) {
          for (let z = 0; z < 16; z++) {
            let packed = 0n;
            for (let x = 0; x < 16; x++) {
              let pIdx = 0;
              if (yOffset === 15 && x <= 4 && z <= 4) {
                pIdx = x === 4 || z === 4 ? 2 : 1;
              }
              packed |= BigInt(pIdx) << BigInt(x * 4);
            }
            chunkData.writeLong(BigInt.asIntN(64, packed));
          }
        }
      } else {
        // Empty air section (single-valued palette: blockCount = 0)
        chunkData.writeShort(0);
        chunkData.writeUByte(0);
        chunkData.writeVarInt(BLOCK_IDS.AIR);
        if (!omitPaletteDataLength) {
          chunkData.writeVarInt(0);
        }
      }

      // Biomes container (single-valued plains = 0)
      chunkData.writeUByte(0);
      chunkData.writeVarInt(0);
      if (!omitPaletteDataLength) {
        chunkData.writeVarInt(0);
      }
    }

    const sectionBytes = chunkData.toBuffer();
    w.writeVarInt(sectionBytes.length);
    w.writeBytes(sectionBytes);

    // Block Entities (0)
    w.writeVarInt(0);

    // Light Data (26 light sections covering -1..24):
    // Sections 9..25 (y >= 64 and sky) are fully sunlit (17 sections)
    const skyLightMask = 0b11111111111111111000000000n; // bits 9..25 (17 sections)
    const emptySkyLightMask = 0b00000000000000000111111111n; // bits 0..8
    const blockLightMask = 0n;
    const emptyBlockLightMask = 0x3ffffffn; // all 26 bits empty block light

    // Sky Light Mask
    w.writeVarInt(1);
    w.writeLong(skyLightMask);
    // Block Light Mask
    w.writeVarInt(1);
    w.writeLong(blockLightMask);
    // Empty Sky Light Mask
    w.writeVarInt(1);
    w.writeLong(emptySkyLightMask);
    // Empty Block Light Mask
    w.writeVarInt(1);
    w.writeLong(emptyBlockLightMask);

    // Sky Light Arrays (17 sections matching bits 9..25)
    w.writeVarInt(17);
    for (let i = 0; i < 17; i++) {
      w.writeVarInt(FULL_BRIGHT_LIGHT_SECTION.length);
      w.writeBytes(FULL_BRIGHT_LIGHT_SECTION);
    }

    // Block Light Arrays (0)
    w.writeVarInt(0);

    return w.toBuffer();
  }
}
