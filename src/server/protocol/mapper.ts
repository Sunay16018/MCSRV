import type { ProtocolState } from '../../shared/types.ts';

export const PRIMARY_PROTOCOL_VERSION = 777;
export const PRIMARY_MINECRAFT_VERSION = '26.3';
export const MIN_SUPPORTED_PROTOCOL = 767; // Minecraft 1.21
export const MAX_SUPPORTED_PROTOCOL = 777; // Minecraft 26.3
export const SUPPORTED_RANGE_LABEL = '1.21 – 26.3';

export interface ProtocolProfile {
  protocolVersion: number;
  label: string;
  isNative777: boolean;
  viaTranslated: boolean;
  usesFlatHeightmaps: boolean; // >= 770 (1.21.5+) uses flat arrays instead of NBT heightmaps
  hasStrictLoginSuccessFlag: boolean; // 767 (1.21/1.21.1) includes trailing strictErrorHandling boolean
  serverbound: {
    CONFIGURATION: Record<number, string>;
    PLAY: Record<number, string>;
  };
  clientbound: {
    LOGIN: Record<string, number>;
    CONFIGURATION: Record<string, number>;
    PLAY: Record<string, number>;
  };
}

// Canonical Protocol 777 (Minecraft Java Edition 26.3) packet mappings
const PLAY_SERVERBOUND_777: Record<number, string> = {
  0x00: 'confirm_teleportation',
  0x04: 'chat_command',
  0x05: 'chat_command_signed',
  0x06: 'chat',
  0x0a: 'client_information',
  0x0f: 'container_close',
  0x12: 'custom_payload',
  0x18: 'keep_alive',
  0x1a: 'move_player_pos',
  0x1b: 'move_player_pos_rot',
  0x1c: 'move_player_rot',
  0x1d: 'move_player_status_only',
  0x1e: 'player_abilities',
  0x24: 'player_action',
  0x25: 'player_command',
  0x2f: 'set_carried_item',
  0x36: 'swing',
  0x38: 'use_item_on',
  0x39: 'use_item',
};

// Serverbound Play IDs for 1.21 / 1.21.1 (Protocol 767)
const PLAY_SERVERBOUND_767: Record<number, string> = {
  ...PLAY_SERVERBOUND_777,
  0x04: 'chat_command',
  0x05: 'chat_command_signed',
  0x06: 'chat',
  0x18: 'keep_alive',
  0x1a: 'move_player_pos',
  0x1b: 'move_player_pos_rot',
  0x1c: 'move_player_rot',
  0x24: 'player_action',
  0x38: 'use_item_on',
};

const PLAY_CLIENTBOUND_777: Record<string, number> = {
  block_update: 0x09,
  chat_system: 0x6c,
  disconnect_play: 0x1d,
  game_event: 0x22,
  keep_alive: 0x26,
  level_chunk_with_light: 0x27,
  login_play: 0x2b,
  move_entity_pos: 0x2e,
  move_entity_pos_rot: 0x2f,
  player_abilities: 0x38,
  player_info_remove: 0x3d,
  player_info_update: 0x3e,
  player_position: 0x40,
  remove_entities: 0x42,
  rotate_head: 0x48,
  set_chunk_cache_center: 0x54,
  set_default_spawn_position: 0x56,
  set_health: 0x5d,
  spawn_entity: 0x01,
  teleport_entity: 0x70,
};

const CONFIG_SERVERBOUND_777: Record<number, string> = {
  0x00: 'client_information',
  0x01: 'cookie_response',
  0x02: 'custom_payload',
  0x03: 'finish_configuration',
  0x04: 'keep_alive',
  0x05: 'pong',
  0x06: 'resource_pack',
  0x07: 'select_known_packs',
};

const CONFIG_CLIENTBOUND_777: Record<string, number> = {
  custom_payload: 0x01,
  disconnect_config: 0x02,
  finish_configuration: 0x03,
  keep_alive: 0x04,
  registry_data: 0x07,
  update_tags: 0x0d,
  select_known_packs: 0x0e,
};

export const SUPPORTED_VERSIONS: Record<number, string> = {
  777: '26.3',
  776: '26.2',
  775: '26.1',
  774: '1.21.11',
  773: '1.21.9',
  772: '1.21.7',
  771: '1.21.6',
  770: '1.21.5',
  769: '1.21.4',
  768: '1.21.2 / 1.21.3',
  767: '1.21 / 1.21.1',
};

export class ProtocolMapper {
  public static resolveProfile(clientProtocol: number): ProtocolProfile {
    const label = SUPPORTED_VERSIONS[clientProtocol] ?? `Proto-${clientProtocol}`;
    const isNative777 = clientProtocol === PRIMARY_PROTOCOL_VERSION;
    const viaTranslated = !isNative777 && this.isSupported(clientProtocol);

    const playClientbound = { ...PLAY_CLIENTBOUND_777 };
    const playServerbound = clientProtocol === 767 ? { ...PLAY_SERVERBOUND_767 } : { ...PLAY_SERVERBOUND_777 };

    // ViaBackwards clientbound packet ID adjustments for 1.21 (767) - 1.21.4 (769)
    if (clientProtocol === 767) {
      playClientbound.block_update = 0x09;
      playClientbound.disconnect_play = 0x1d;
      playClientbound.game_event = 0x22;
      playClientbound.keep_alive = 0x26;
      playClientbound.level_chunk_with_light = 0x27;
      playClientbound.login_play = 0x2b;
      playClientbound.player_abilities = 0x38;
      playClientbound.player_info_remove = 0x3d;
      playClientbound.player_info_update = 0x3e;
      playClientbound.player_position = 0x40;
      playClientbound.remove_entities = 0x42;
      playClientbound.set_chunk_cache_center = 0x54;
      playClientbound.set_default_spawn_position = 0x56;
      playClientbound.set_health = 0x5d;
      playClientbound.chat_system = 0x6c;
    } else if (clientProtocol === 768 || clientProtocol === 769) {
      playClientbound.login_play = 0x2c;
      playClientbound.keep_alive = 0x27;
      playClientbound.level_chunk_with_light = 0x28;
      playClientbound.player_position = 0x42;
      playClientbound.chat_system = 0x73;
    }

    return {
      protocolVersion: clientProtocol,
      label,
      isNative777,
      viaTranslated,
      usesFlatHeightmaps: clientProtocol >= 770,
      hasStrictLoginSuccessFlag: clientProtocol === 767,
      serverbound: {
        CONFIGURATION: { ...CONFIG_SERVERBOUND_777 },
        PLAY: playServerbound,
      },
      clientbound: {
        LOGIN: {
          disconnect: 0x00,
          encryption_request: 0x01,
          login_success: 0x02,
          set_compression: 0x03,
        },
        CONFIGURATION: { ...CONFIG_CLIENTBOUND_777 },
        PLAY: playClientbound,
      },
    };
  }

  public static isSupported(protocolVersion: number): boolean {
    return protocolVersion >= MIN_SUPPORTED_PROTOCOL && protocolVersion <= MAX_SUPPORTED_PROTOCOL;
  }

  public static getServerboundName(state: ProtocolState, packetId: number, profile: ProtocolProfile): string {
    if (state === 'HANDSHAKE') {
      return packetId === 0x00 ? 'handshake_intention' : `handshake_0x${packetId.toString(16)}`;
    }
    if (state === 'STATUS') {
      if (packetId === 0x00) return 'status_request';
      if (packetId === 0x01) return 'ping_request';
      return `status_0x${packetId.toString(16)}`;
    }
    if (state === 'LOGIN') {
      if (packetId === 0x00) return 'login_start';
      if (packetId === 0x01) return 'encryption_response';
      if (packetId === 0x02) return 'login_query_response';
      if (packetId === 0x03) return 'login_acknowledged';
      return `login_0x${packetId.toString(16)}`;
    }
    if (state === 'CONFIGURATION') {
      return profile.serverbound.CONFIGURATION[packetId] ?? `config_sb_0x${packetId.toString(16)}`;
    }
    return profile.serverbound.PLAY[packetId] ?? `play_sb_0x${packetId.toString(16)}`;
  }

  public static getClientboundName(state: ProtocolState, packetId: number, profile: ProtocolProfile): string {
    if (state === 'STATUS') {
      if (packetId === 0x00) return 'status_response';
      if (packetId === 0x01) return 'pong_response';
    }
    if (state === 'LOGIN') {
      for (const [name, id] of Object.entries(profile.clientbound.LOGIN)) {
        if (id === packetId) return name;
      }
    }
    if (state === 'CONFIGURATION') {
      for (const [name, id] of Object.entries(profile.clientbound.CONFIGURATION)) {
        if (id === packetId) return name;
      }
    }
    if (state === 'PLAY') {
      for (const [name, id] of Object.entries(profile.clientbound.PLAY)) {
        if (id === packetId) return name;
      }
    }
    return `cb_${state.toLowerCase()}_0x${packetId.toString(16)}`;
  }
}
