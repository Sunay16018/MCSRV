import type { AetherPlugin, PluginPlayer } from '../src/server/plugins/pluginApi.ts';

interface ViaSessionStats {
  username: string;
  protocolVersion: number;
  clientVersion: string;
  translatedPackets: number;
  joinedAt: number;
}

const SUPPORTED_MATRIX: Record<number, { name: string; pipeline: string }> = {
  777: { name: '26.3 (Native)', pipeline: 'Native Core' },
  776: { name: '26.2', pipeline: 'Backwards26_2To26_3' },
  775: { name: '26.1', pipeline: 'Backwards26_1To26_2' },
  774: { name: '1.21.11', pipeline: 'Backwards1_21_11To26_1' },
  773: { name: '1.21.9', pipeline: 'Backwards1_21_9To1_21_11' },
  772: { name: '1.21.7', pipeline: 'Backwards1_21_7To1_21_9' },
  771: { name: '1.21.6', pipeline: 'Backwards1_21_6To1_21_7' },
  770: { name: '1.21.5', pipeline: 'Backwards1_21_5To1_21_6' },
  769: { name: '1.21.4', pipeline: 'Backwards1_21_4To1_21_5 (NBT Heightmap)' },
  768: { name: '1.21.2 / 1.21.3', pipeline: 'Backwards1_21_2To1_21_4' },
  767: { name: '1.21 / 1.21.1', pipeline: 'Backwards1_21To1_21_2 (Legacy Login + NBT)' },
};

const activeSessions = new Map<string, ViaSessionStats>();
let totalTranslatedPackets = 0;

const viaBackwards: AetherPlugin = {
  name: 'ViaBackwards',
  version: '5.3.0-26.3',
  description:
    'Allows Minecraft Java Edition 1.21 – 26.2 clients (Protocols 767–776) to join native 26.3 (Protocol 777) servers with live packet & chunk translation.',
  author: 'ViaVersion / AetherCore',

  onEnable(ctx) {
    activeSessions.clear();
    totalTranslatedPackets = 0;

    // Seed stats for any already-online players after hot-reload
    for (const p of ctx.getOnlinePlayers()) {
      if (p.protocolVersion !== 777) {
        activeSessions.set(p.uuid, {
          username: p.username,
          protocolVersion: p.protocolVersion,
          clientVersion: p.clientVersionLabel,
          translatedPackets: 0,
          joinedAt: Date.now(),
        });
      }
    }

    ctx.log('ViaBackwards enabled — translating Minecraft 1.21 (767) -> 26.3 (777) pipelines.');

    ctx.on('onPlayerJoin', (player: PluginPlayer) => {
      const info = SUPPORTED_MATRIX[player.protocolVersion];
      if (player.protocolVersion !== 777) {
        activeSessions.set(player.uuid, {
          username: player.username,
          protocolVersion: player.protocolVersion,
          clientVersion: info?.name ?? player.clientVersionLabel,
          translatedPackets: 0,
          joinedAt: Date.now(),
        });
        ctx.log(
          `Translating ${player.username} from ${info?.name ?? player.clientVersionLabel} (proto ${player.protocolVersion}) via ${info?.pipeline ?? 'BackwardsCompat'}`
        );
        player.sendMessage(
          `[ViaBackwards] Connected on ${info?.name ?? player.clientVersionLabel} (translated to 26.3 engine).`,
          'aqua'
        );
      } else {
        ctx.log(`${player.username} joined on native 26.3 (proto 777) — zero translation overhead.`);
      }
    });

    ctx.on('onPacketReceive', (evt) => {
      if (!evt.player || evt.player.protocolVersion === 777) return;
      const session = activeSessions.get(evt.player.uuid);
      if (session) {
        session.translatedPackets++;
        totalTranslatedPackets++;
      }
    });

    ctx.on('onPlayerQuit', (player) => {
      activeSessions.delete(player.uuid);
    });

    ctx.registerCommand(
      'viabackwards',
      (cmd) => {
        const sub = (cmd.args[0] ?? 'status').toLowerCase();

        if (sub === 'versions' || sub === 'list') {
          const list = Object.entries(SUPPORTED_MATRIX)
            .map(([proto, v]) => `${v.name} (${proto})`)
            .join(', ');
          cmd.reply(`[ViaBackwards] Supported 1.21–26.3 Protocols: ${list}`);
          return;
        }

        if (sub === 'players') {
          if (activeSessions.size === 0) {
            cmd.reply('[ViaBackwards] No translated backwards-protocol players online right now.');
            return;
          }
          for (const s of activeSessions.values()) {
            cmd.reply(
              ` - ${s.username}: ${s.clientVersion} (proto ${s.protocolVersion}) · ${s.translatedPackets} packets rewritten`
            );
          }
          return;
        }

        cmd.reply(
          `[ViaBackwards v5.3.0-26.3] Active for 1.21 (767) -> 26.3 (777) · Translated sessions: ${activeSessions.size} · Rewritten packets: ${totalTranslatedPackets}`
        );
        cmd.reply('Subcommands: /viabackwards status | versions | players');
      },
      {
        description: 'Inspect ViaBackwards 1.21–26.3 translation pipeline and sessions',
        aliases: ['vb', 'viaver', 'protocol'],
      }
    );
  },

  onDisable() {
    activeSessions.clear();
  },
};

export default viaBackwards;
