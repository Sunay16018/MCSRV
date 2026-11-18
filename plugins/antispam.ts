import type { AetherPlugin } from '../src/server/plugins/pluginApi.ts';

interface ChatRecord {
  timestamps: number[];
  lastMessage: string;
  blockedCount: number;
}

const history = new Map<string, ChatRecord>();
const WINDOW_MS = 4000;
const MAX_MESSAGES_IN_WINDOW = 3;

const antispam: AetherPlugin = {
  name: 'AntiSpamGuard',
  version: '1.2.0',
  description: 'Protects chat against rapid message flooding and duplicate spam bursts.',
  author: 'AetherCore Security',

  onEnable(ctx) {
    history.clear();
    ctx.log(`AntiSpamGuard active (max ${MAX_MESSAGES_IN_WINDOW} msgs / ${WINDOW_MS / 1000}s)`);

    ctx.on('onPlayerChat', (event) => {
      const now = Date.now();
      const key = event.player.uuid;
      const rec = history.get(key) ?? { timestamps: [], lastMessage: '', blockedCount: 0 };

      // Prune old timestamps outside sliding window
      rec.timestamps = rec.timestamps.filter((t) => now - t < WINDOW_MS);

      const normalized = event.message.trim().toLowerCase();
      const isDuplicate = rec.lastMessage === normalized && rec.timestamps.length > 0;
      const isFlood = rec.timestamps.length >= MAX_MESSAGES_IN_WINDOW;

      if (isFlood || isDuplicate) {
        event.cancel = true;
        rec.blockedCount += 1;
        history.set(key, rec);
        const reason = isDuplicate ? 'Duplicate message blocked' : 'Rate limit exceeded — slow down!';
        event.player.sendMessage(`[AntiSpam] ${reason}`, 'red');
        ctx.log(`Blocked spam from ${event.player.username}: "${event.message}" (${reason})`, 'WARN');
        return;
      }

      rec.timestamps.push(now);
      rec.lastMessage = normalized;
      history.set(key, rec);
    });

    ctx.on('onPlayerQuit', (player) => {
      history.delete(player.uuid);
    });
  },

  onDisable() {
    history.clear();
  },
};

export default antispam;
