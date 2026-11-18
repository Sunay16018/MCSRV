import type { ProtocolState } from '../../shared/types.ts';

export const PRIMARY_PROTOCOL_VERSION = 777;
export const PRIMARY_MINECRAFT_VERSION = '26.3';
export const MIN_SUPPORTED_PROTOCOL = 767; // Minecraft 1.21
export const MAX_SUPPORTED_PROTOCOL = 777; // Minecraft 26.3
export const SUPPORTED_RANGE_LABEL = '1.21 – 26.3';

export interface ProtocolProfile {
  protocolVersion: number;
  label: string;
  knownPackVersion: string;
  isNative777: boolean;
  viaTranslated: boolean;
  usesFlatHeightmaps: boolean; // >= 770 (1.21.5+) uses flat arrays instead of NBT heightmaps
  hasStrictLoginSuccessFlag: boolean; // 767 (1.21/1.21.1) includes trailing strictErrorHandling boolean
  hasSeaLevelInLoginPlay: boolean; // >= 768 (1.21.2+) includes seaLevel VarInt in Login (Play)
  hasVelocityInPlayerPosition: boolean; // >= 768 (1.21.2+) uses teleportId + pos + vel + rot + flags(Int)
  hasClientTickEnd: boolean; // >= 768 / enforced >= 771
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

// 1.21 / 1.21.1 (Protocol 767)
const PLAY_SERVERBOUND_767: Record<number, string> = {
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
  0x23: 'player_abilities',
  0x24: 'player_action',
  0x25: 'player_command',
  0x2f: 'set_carried_item',
  0x36: 'swing',
  0x38: 'use_item_on',
  0x39: 'use_item',
};

// 1.21.2 - 1.21.4 (Protocols 768 - 769)
const PLAY_SERVERBOUND_768_769: Record<number, string> = {
  0x00: 'confirm_teleportation',
  0x05: 'chat_command',
  0x06: 'chat_command_signed',
  0x07: 'chat',
  0x08: 'chat_session_update',
  0x0b: 'client_tick_end',
  0x0c: 'client_information',
  0x11: 'container_close',
  0x14: 'custom_payload',
  0x1a: 'keep_alive',
  0x1c: 'move_player_pos',
  0x1d: 'move_player_pos_rot',
  0x1e: 'move_player_rot',
  0x1f: 'move_player_status_only',
  0x26: 'player_abilities',
  0x27: 'player_action',
  0x28: 'player_command',
  0x31: 'set_carried_item',
  0x38: 'swing',
  0x3a: 'use_item_on',
  0x3b: 'use_item',
};

// 1.21.5 (Protocol 770)
const PLAY_SERVERBOUND_770: Record<number, string> = {
  0x00: 'confirm_teleportation',
  0x05: 'chat_command',
  0x06: 'chat_command_signed',
  0x07: 'chat',
  0x08: 'chat_session_update',
  0x0b: 'client_tick_end',
  0x0c: 'client_information',
  0x11: 'container_close',
  0x14: 'custom_payload',
  0x1a: 'keep_alive',
  0x1c: 'move_player_pos',
  0x1d: 'move_player_pos_rot',
  0x1e: 'move_player_rot',
  0x1f: 'move_player_status_only',
  0x26: 'player_abilities',
  0x27: 'player_action',
  0x28: 'player_command',
  0x33: 'set_carried_item',
  0x3a: 'swing',
  0x3c: 'use_item_on',
  0x3d: 'use_item',
};

// 1.21.6 - 1.21.11 (Protocols 771 - 774)
const PLAY_SERVERBOUND_771_774: Record<number, string> = {
  0x00: 'confirm_teleportation',
  0x05: 'chat_command',
  0x06: 'chat_command_signed',
  0x07: 'chat',
  0x08: 'chat_session_update',
  0x0c: 'client_tick_end',
  0x0d: 'client_information',
  0x12: 'container_close',
  0x15: 'custom_payload',
  0x1b: 'keep_alive',
  0x1d: 'move_player_pos',
  0x1e: 'move_player_pos_rot',
  0x1f: 'move_player_rot',
  0x20: 'move_player_status_only',
  0x27: 'player_abilities',
  0x28: 'player_action',
  0x29: 'player_command',
  0x34: 'set_carried_item',
  0x3b: 'swing',
  0x3d: 'use_item_on',
  0x3e: 'use_item',
};

// 26.1 - 26.3 (Protocols 775 - 777)
const PLAY_SERVERBOUND_775_PLUS: Record<number, string> = {
  0x00: 'confirm_teleportation',
  0x05: 'chat_command',
  0x06: 'chat_command_signed',
  0x07: 'chat',
  0x08: 'chat_session_update',
  0x0d: 'client_tick_end',
  0x0e: 'client_information',
  0x13: 'container_close',
  0x16: 'custom_payload',
  0x1c: 'keep_alive',
  0x1e: 'move_player_pos',
  0x1f: 'move_player_pos_rot',
  0x20: 'move_player_rot',
  0x21: 'move_player_status_only',
  0x28: 'player_abilities',
  0x29: 'player_action',
  0x2a: 'player_command',
  0x35: 'set_carried_item',
  0x3c: 'swing',
  0x3e: 'use_item_on',
  0x3f: 'use_item',
};

const PLAY_CLIENTBOUND_767: Record<string, number> = {
  spawn_entity: 0x01,
  block_update: 0x09,
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
  chat_system: 0x6c,
  teleport_entity: 0x70,
};

const PLAY_CLIENTBOUND_768_769: Record<string, number> = {
  spawn_entity: 0x01,
  block_update: 0x09,
  disconnect_play: 0x1d,
  game_event: 0x23,
  keep_alive: 0x27,
  level_chunk_with_light: 0x28,
  login_play: 0x2c,
  move_entity_pos: 0x2f,
  move_entity_pos_rot: 0x30,
  player_abilities: 0x39,
  player_info_remove: 0x3f,
  player_info_update: 0x40,
  player_position: 0x42,
  remove_entities: 0x47,
  rotate_head: 0x4d,
  set_chunk_cache_center: 0x58,
  set_default_spawn_position: 0x5b,
  set_health: 0x62,
  chat_system: 0x73,
  teleport_entity: 0x77,
};

const PLAY_CLIENTBOUND_770: Record<string, number> = {
  spawn_entity: 0x01,
  block_update: 0x08,
  disconnect_play: 0x1c,
  game_event: 0x22,
  keep_alive: 0x26,
  level_chunk_with_light: 0x27,
  login_play: 0x2b,
  move_entity_pos: 0x2e,
  move_entity_pos_rot: 0x2f,
  player_abilities: 0x38,
  player_info_remove: 0x3e,
  player_info_update: 0x3f,
  player_position: 0x41,
  remove_entities: 0x46,
  rotate_head: 0x4c,
  set_chunk_cache_center: 0x57,
  set_default_spawn_position: 0x5a,
  set_health: 0x61,
  chat_system: 0x72,
  teleport_entity: 0x76,
};

const PLAY_CLIENTBOUND_771_772: Record<string, number> = {
  spawn_entity: 0x01,
  block_update: 0x08,
  disconnect_play: 0x1c,
  game_event: 0x22,
  keep_alive: 0x26,
  level_chunk_with_light: 0x27,
  login_play: 0x2b,
  move_entity_pos: 0x2e,
  move_entity_pos_rot: 0x2f,
  player_abilities: 0x38,
  player_info_remove: 0x3e,
  player_info_update: 0x3f,
  player_position: 0x41,
  remove_entities: 0x46,
  rotate_head: 0x4c,
  set_chunk_cache_center: 0x57,
  set_default_spawn_position: 0x5a,
  set_health: 0x61,
  chat_system: 0x72,
  teleport_entity: 0x76,
};

const PLAY_CLIENTBOUND_773_774: Record<string, number> = {
  spawn_entity: 0x01,
  block_update: 0x08,
  disconnect_play: 0x20,
  game_event: 0x26,
  keep_alive: 0x2a,
  level_chunk_with_light: 0x2b,
  login_play: 0x2f,
  move_entity_pos: 0x32,
  move_entity_pos_rot: 0x33,
  player_abilities: 0x3c,
  player_info_remove: 0x42,
  player_info_update: 0x43,
  player_position: 0x45,
  remove_entities: 0x4a,
  rotate_head: 0x50,
  set_chunk_cache_center: 0x5b,
  set_default_spawn_position: 0x5e,
  set_health: 0x65,
  chat_system: 0x76,
  teleport_entity: 0x7a,
};

const PLAY_CLIENTBOUND_775_PLUS: Record<string, number> = {
  spawn_entity: 0x01,
  block_update: 0x08,
  disconnect_play: 0x21,
  game_event: 0x27,
  keep_alive: 0x2b,
  level_chunk_with_light: 0x2c,
  login_play: 0x30,
  move_entity_pos: 0x33,
  move_entity_pos_rot: 0x34,
  player_abilities: 0x3e,
  player_info_remove: 0x44,
  player_info_update: 0x45,
  player_position: 0x47,
  remove_entities: 0x4c,
  rotate_head: 0x52,
  set_chunk_cache_center: 0x5d,
  set_default_spawn_position: 0x60,
  set_health: 0x67,
  chat_system: 0x78,
  teleport_entity: 0x7c,
};

const CONFIG_SERVERBOUND_ALL: Record<number, string> = {
  0x00: 'client_information',
  0x01: 'cookie_response',
  0x02: 'custom_payload',
  0x03: 'finish_configuration',
  0x04: 'keep_alive',
  0x05: 'pong',
  0x06: 'resource_pack',
  0x07: 'select_known_packs',
};

const CONFIG_CLIENTBOUND_ALL: Record<string, number> = {
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
    const knownPackVersion = label.split(' ')[0];
    const isNative777 = clientProtocol === PRIMARY_PROTOCOL_VERSION;
    const viaTranslated = !isNative777 && this.isSupported(clientProtocol);

    let playClientbound: Record<string, number>;
    let playServerbound: Record<number, string>;

    if (clientProtocol === 767) {
      playClientbound = { ...PLAY_CLIENTBOUND_767 };
      playServerbound = { ...PLAY_SERVERBOUND_767 };
    } else if (clientProtocol === 768 || clientProtocol === 769) {
      playClientbound = { ...PLAY_CLIENTBOUND_768_769 };
      playServerbound = { ...PLAY_SERVERBOUND_768_769 };
    } else if (clientProtocol === 770) {
      playClientbound = { ...PLAY_CLIENTBOUND_770 };
      playServerbound = { ...PLAY_SERVERBOUND_770 };
    } else if (clientProtocol === 771 || clientProtocol === 772) {
      playClientbound = { ...PLAY_CLIENTBOUND_771_772 };
      playServerbound = { ...PLAY_SERVERBOUND_771_774 };
    } else if (clientProtocol === 773 || clientProtocol === 774) {
      playClientbound = { ...PLAY_CLIENTBOUND_773_774 };
      playServerbound = { ...PLAY_SERVERBOUND_771_774 };
    } else {
      playClientbound = { ...PLAY_CLIENTBOUND_775_PLUS };
      playServerbound = { ...PLAY_SERVERBOUND_775_PLUS };
    }

    return {
      protocolVersion: clientProtocol,
      label,
      knownPackVersion,
      isNative777,
      viaTranslated,
      usesFlatHeightmaps: clientProtocol >= 770,
      hasStrictLoginSuccessFlag: clientProtocol === 767,
      hasSeaLevelInLoginPlay: clientProtocol >= 768,
      hasVelocityInPlayerPosition: clientProtocol >= 768,
      hasClientTickEnd: clientProtocol >= 768,
      serverbound: {
        CONFIGURATION: { ...CONFIG_SERVERBOUND_ALL },
        PLAY: playServerbound,
      },
      clientbound: {
        LOGIN: {
          disconnect: 0x00,
          encryption_request: 0x01,
          login_success: 0x02,
          set_compression: 0x03,
        },
        CONFIGURATION: { ...CONFIG_CLIENTBOUND_ALL },
        PLAY: playClientbound,
      },
    };
  }

  public static getServerboundId(state: ProtocolState, packetName: string, profile: ProtocolProfile): number | undefined {
    const map = state === 'CONFIGURATION' ? profile.serverbound.CONFIGURATION : profile.serverbound.PLAY;
    for (const [idStr, name] of Object.entries(map)) {
      if (name === packetName) return Number(idStr);
    }
    return undefined;
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
