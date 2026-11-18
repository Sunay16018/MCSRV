import { useState } from 'react';
import {
  Ban,
  Crosshair,
  Footprints,
  LogOut,
  Send,
  Shield,
  ShieldOff,
  UserPlus,
  Users,
} from 'lucide-react';
import type { BannedPlayer, PlayerInfo } from '../shared/types.ts';
import { apiFetch } from '../hooks/useServerSocket.ts';

interface PlayersViewProps {
  players: PlayerInfo[];
  bans: BannedPlayer[];
  onToast: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

export function PlayersView({ players, bans, onToast }: PlayersViewProps) {
  const [selectedBot, setSelectedBot] = useState<string>('');
  const [spawnProtocol, setSpawnProtocol] = useState<number>(777);
  const [botChat, setBotChat] = useState('/viabackwards');
  const [tpTarget, setTpTarget] = useState<{ username: string; x: string; y: string; z: string } | null>(null);
  const [spawning, setSpawning] = useState(false);

  const activeBots = players.filter((p) => p.isBotProbe);
  const targetBotName = selectedBot && activeBots.some((b) => b.username === selectedBot)
    ? selectedBot
    : activeBots[0]?.username ?? '';

  const spawnBot = async () => {
    setSpawning(true);
    try {
      const res = await apiFetch('/api/probe/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: spawnProtocol }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Spawn failed');
      setSelectedBot(data.username);
      onToast(
        'success',
        'Test Player Joined',
        `${data.username} connected via TCP protocol ${data.protocolVersion}.`
      );
    } catch (err) {
      onToast('error', 'Failed', (err as Error).message);
    } finally {
      setSpawning(false);
    }
  };

  const sendBotAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetBotName || !botChat.trim()) return;
    await apiFetch('/api/probe/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetBotName, message: botChat.trim() }),
    });
    setBotChat('');
  };

  const stepMoveBot = async (username: string) => {
    await apiFetch('/api/probe/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, dx: 2.5, dy: 0, dz: -1.5 }),
    });
  };

  const toggleOp = async (player: PlayerInfo) => {
    await apiFetch(`/api/players/${encodeURIComponent(player.username)}/op`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: !player.isOp }),
    });
    onToast('success', player.isOp ? 'OP Removed' : 'OP Granted', `${player.username}`);
  };

  const kickPlayer = async (player: PlayerInfo) => {
    await apiFetch(`/api/players/${encodeURIComponent(player.username)}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Kicked by Administrator' }),
    });
    onToast('warn', 'Player Kicked', `${player.username} disconnected.`);
  };

  const banPlayer = async (player: PlayerInfo) => {
    await apiFetch(`/api/players/${encodeURIComponent(player.username)}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Banned by Administrator' }),
    });
    onToast('warn', 'Player Banned', `${player.username} added to bans.json.`);
  };

  const unbanPlayer = async (username: string) => {
    await apiFetch('/api/players/unban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    onToast('success', 'Unbanned', `${username} removed from ban list.`);
  };

  const submitTeleport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tpTarget) return;
    const x = Number(tpTarget.x);
    const y = Number(tpTarget.y);
    const z = Number(tpTarget.z);
    if ([x, y, z].some(Number.isNaN)) return;
    await apiFetch(`/api/players/${encodeURIComponent(tpTarget.username)}/tp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, z }),
    });
    onToast('success', 'Teleported', `Moved ${tpTarget.username} to (${x}, ${y}, ${z})`);
    setTpTarget(null);
  };

  return (
    <div className="space-y-6">
      {/* Header & TCP Test Client Quick Controls */}
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Online Players</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {players.length} active connections · Supports Minecraft 1.21 – 26.3 via ViaBackwards
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={spawnProtocol}
              onChange={(e) => setSpawnProtocol(Number(e.target.value))}
              className="px-2.5 py-2 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value={777}>26.3 (777 Native)</option>
              <option value={775}>26.1 (775 Via)</option>
              <option value={770}>1.21.5 (770 Via)</option>
              <option value={769}>1.21.4 (769 Via)</option>
              <option value={767}>1.21 (767 Via)</option>
            </select>
            <button
              onClick={spawnBot}
              disabled={spawning}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              {spawning ? 'Connecting...' : 'Spawn TCP Test Player'}
            </button>
          </div>
        </div>

        {activeBots.length > 0 && (
          <form onSubmit={sendBotAction} className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-2.5">
            <select
              value={targetBotName}
              onChange={(e) => setSelectedBot(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              {activeBots.map((b) => (
                <option key={b.uuid} value={b.username}>
                  {b.username} ({b.clientVersionLabel})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={botChat}
              onChange={(e) => setBotChat(e.target.value)}
              placeholder="Send chat or /command as test player (e.g. /fly, /viabackwards, /heal)"
              className="flex-1 min-w-60 px-3 py-1.5 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Send Packet
            </button>
            <button
              type="button"
              onClick={() => stepMoveBot(targetBotName)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Footprints className="w-3.5 h-3.5" />
              Step Move
            </button>
          </form>
        )}
      </div>

      {/* Teleport Inline Modal */}
      {tpTarget && (
        <form onSubmit={submitTeleport} className="bg-[#111620] border border-emerald-800/60 rounded-lg p-4 flex flex-wrap items-end gap-3">
          <div className="text-xs font-medium text-slate-200 w-full sm:w-auto">
            Teleport <span className="font-mono text-emerald-400">{tpTarget.username}</span> to:
          </div>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={axis} className="w-24">
              <label className="block text-xs text-slate-400 mb-1 uppercase">{axis}</label>
              <input
                type="number"
                step="0.5"
                value={tpTarget[axis]}
                onChange={(e) => setTpTarget({ ...tpTarget, [axis]: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0b0e14] border border-slate-700 rounded text-slate-100"
              />
            </div>
          ))}
          <button
            type="submit"
            className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
          >
            Confirm Teleport
          </button>
          <button
            type="button"
            onClick={() => setTpTarget(null)}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Players Table */}
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg overflow-hidden">
        {players.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-300">No players currently online</div>
            <p className="text-xs text-slate-500 mt-1">
              Connect a Minecraft 1.21 – 26.3 client to port 25565 or spawn a TCP test player above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400 bg-[#0b0e14]/60">
                  <th className="py-3 px-4 font-medium">Player</th>
                  <th className="py-3 px-4 font-medium">UUID & Protocol</th>
                  <th className="py-3 px-4 font-medium">Mode / State</th>
                  <th className="py-3 px-4 font-medium text-right">Ping</th>
                  <th className="py-3 px-4 font-medium text-right">Coordinates (X, Y, Z)</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {players.map((p) => (
                  <tr key={p.uuid} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-100">{p.username}</div>
                      <div className="text-slate-500 font-mono text-[11px]">{p.ip}</div>
                    </td>
                    <td className="py-3 px-4 font-mono">
                      <div className="text-slate-300 text-[11px]">{p.uuid}</div>
                      <div className="text-slate-500 text-[11px]">
                        {p.clientVersionLabel} · Proto {p.protocolVersion} ·{' '}
                        <span className={p.viaTranslated ? 'text-sky-400' : 'text-emerald-400'}>
                          {p.viaTranslated ? 'ViaBackwards' : 'Native'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-slate-200 capitalize">
                        {p.gamemode} · {p.isOp ? 'OP' : 'Member'}
                      </div>
                      <div className="text-slate-500 font-mono text-[11px] tabular-nums">
                        HP {p.health}/20 · {p.isFlying ? 'Flying' : 'Grounded'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400">
                      {p.ping} ms
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                      {p.x.toFixed(1)}, {p.y.toFixed(1)}, {p.z.toFixed(1)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => toggleOp(p)}
                          title={p.isOp ? 'Remove OP' : 'Grant OP'}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                        >
                          {p.isOp ? <ShieldOff className="w-3.5 h-3.5 text-amber-400" /> : <Shield className="w-3.5 h-3.5 text-emerald-400" />}
                        </button>
                        <button
                          onClick={() =>
                            setTpTarget({
                              username: p.username,
                              x: String(Math.round(p.x)),
                              y: '64',
                              z: String(Math.round(p.z)),
                            })
                          }
                          title="Teleport"
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                        >
                          <Crosshair className="w-3.5 h-3.5 text-sky-400" />
                        </button>
                        <button
                          onClick={() => kickPlayer(p)}
                          title="Kick Player"
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => banPlayer(p)}
                          title="Ban Player"
                          className="p-1.5 rounded bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-800/60 cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Banned Players */}
      {bans.length > 0 && (
        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-100 mb-3">Banned Accounts ({bans.length})</h3>
          <div className="divide-y divide-slate-800/60">
            {bans.map((b) => (
              <div key={b.username} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                <div>
                  <span className="font-medium text-slate-100">{b.username}</span>
                  <span className="text-slate-500 ml-2">· {b.reason}</span>
                </div>
                <button
                  onClick={() => unbanPlayer(b.username)}
                  className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                >
                  Unban
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
