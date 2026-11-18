import type { GameMode } from '../src/shared/types.ts';
import type { AetherPlugin } from '../src/server/plugins/pluginApi.ts';

const essentials: AetherPlugin = {
  name: 'EssentialsCore',
  version: '2.6.3',
  description: 'Core utility commands: /fly, /tp, /gamemode, /heal, and /plugins with player greeting.',
  author: 'AetherCore Team',

  onEnable(ctx) {
    ctx.log('EssentialsCore initialized (/fly, /tp, /gamemode, /heal, /plugins)');

    ctx.on('onPlayerJoin', (player) => {
      player.sendMessage(`Welcome ${player.username} to AetherCore 26.3 (Protocol 777)!`, 'green');
    });

    ctx.registerCommand(
      'fly',
      (cmd) => {
        const targetName = cmd.args[0];
        const target = targetName ? ctx.getPlayer(targetName) : cmd.sender === 'CONSOLE' ? undefined : cmd.sender;

        if (!target) {
          cmd.reply('Usage: /fly [player]');
          return;
        }

        const nextFlying = !target.isFlying;
        target.setFlying(nextFlying);
        target.sendMessage(`Flight mode ${nextFlying ? 'enabled' : 'disabled'}.`, nextFlying ? 'green' : 'yellow');
        if (cmd.sender === 'CONSOLE' || cmd.sender.username !== target.username) {
          cmd.reply(`Set flight for ${target.username} to ${nextFlying ? 'ON' : 'OFF'}.`);
        }
      },
      { description: 'Toggle flight mode', usage: '/fly [player]' }
    );

    ctx.registerCommand(
      'tp',
      (cmd) => {
        if (cmd.args.length === 1) {
          if (cmd.sender === 'CONSOLE') {
            cmd.reply('Console usage: /tp <player> <target|x y z>');
            return;
          }
          const dest = ctx.getPlayer(cmd.args[0]);
          if (!dest) {
            cmd.reply(`Player "${cmd.args[0]}" is not online.`);
            return;
          }
          cmd.sender.teleport(dest.x, dest.y, dest.z, dest.yaw, dest.pitch);
          cmd.reply(`Teleported to ${dest.username} (${dest.x.toFixed(1)}, ${dest.y.toFixed(1)}, ${dest.z.toFixed(1)}).`);
          return;
        }

        if (cmd.args.length === 2) {
          const src = ctx.getPlayer(cmd.args[0]);
          const dest = ctx.getPlayer(cmd.args[1]);
          if (!src || !dest) {
            cmd.reply('Both source and target players must be online.');
            return;
          }
          src.teleport(dest.x, dest.y, dest.z, dest.yaw, dest.pitch);
          cmd.reply(`Teleported ${src.username} to ${dest.username}.`);
          return;
        }

        if (cmd.args.length === 3 && cmd.sender !== 'CONSOLE') {
          const [x, y, z] = cmd.args.map(Number);
          if ([x, y, z].some((n) => Number.isNaN(n))) {
            cmd.reply('Invalid coordinates. Usage: /tp <x> <y> <z>');
            return;
          }
          cmd.sender.teleport(x, y, z);
          cmd.reply(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}.`);
          return;
        }

        if (cmd.args.length === 4) {
          const target = ctx.getPlayer(cmd.args[0]);
          const [x, y, z] = cmd.args.slice(1).map(Number);
          if (!target || [x, y, z].some((n) => Number.isNaN(n))) {
            cmd.reply('Usage: /tp <player> <x> <y> <z>');
            return;
          }
          target.teleport(x, y, z);
          cmd.reply(`Teleported ${target.username} to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}.`);
          return;
        }

        cmd.reply('Usage: /tp <player> [target] | /tp [player] <x> <y> <z>');
      },
      { description: 'Teleport players to coordinates or other players', aliases: ['teleport'] }
    );

    ctx.registerCommand(
      'gamemode',
      (cmd) => {
        const modeArg = (cmd.args[0] ?? '').toLowerCase();
        const modeMap: Record<string, GameMode> = {
          '0': 'survival',
          s: 'survival',
          survival: 'survival',
          '1': 'creative',
          c: 'creative',
          creative: 'creative',
          '2': 'adventure',
          a: 'adventure',
          adventure: 'adventure',
          '3': 'spectator',
          sp: 'spectator',
          spectator: 'spectator',
        };
        const resolved = modeMap[modeArg];
        if (!resolved) {
          cmd.reply('Usage: /gamemode <survival|creative|adventure|spectator> [player]');
          return;
        }

        const target = cmd.args[1]
          ? ctx.getPlayer(cmd.args[1])
          : cmd.sender === 'CONSOLE'
            ? undefined
            : cmd.sender;

        if (!target) {
          cmd.reply('Target player not found.');
          return;
        }

        target.setGameMode(resolved);
        target.sendMessage(`Your game mode has been updated to ${resolved}.`, 'aqua');
        cmd.reply(`Set ${target.username}'s game mode to ${resolved}.`);
      },
      { description: 'Change player game mode', aliases: ['gm'] }
    );

    ctx.registerCommand(
      'heal',
      (cmd) => {
        const target = cmd.args[0]
          ? ctx.getPlayer(cmd.args[0])
          : cmd.sender === 'CONSOLE'
            ? undefined
            : cmd.sender;

        if (!target) {
          cmd.reply('Usage: /heal [player]');
          return;
        }

        target.setHealth(20, 20);
        target.sendMessage('You have been healed to full health and saturation.', 'green');
        cmd.reply(`Healed ${target.username} (20/20 HP).`);
      },
      { description: 'Restore player health and food' }
    );

    ctx.registerCommand(
      'plugins',
      (cmd) => {
        const all = ctx.getLoadedPlugins();
        const formatted = all
          .map((p) => `${p.name} v${p.version} (${p.enabled ? 'active' : 'disabled'})`)
          .join(', ');
        cmd.reply(`Plugins (${all.length}): ${formatted}`);
      },
      { description: 'List loaded plugins', aliases: ['pl'] }
    );
  },
};

export default essentials;
