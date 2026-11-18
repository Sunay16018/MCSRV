import { useMemo, useState } from 'react';
import { Eraser, Pause, Play, Search, ShieldAlert } from 'lucide-react';
import type { PacketDirection, PacketLogEntry, ProtocolState } from '../shared/types.ts';
import { apiFetch } from '../hooks/useServerSocket.ts';

interface PacketInspectorViewProps {
  packets: PacketLogEntry[];
  onSetPaused: (paused: boolean) => void;
  onClearLocal: () => void;
}

export function PacketInspectorView({
  packets,
  onSetPaused,
  onClearLocal,
}: PacketInspectorViewProps) {
  const [dirFilter, setDirFilter] = useState<'ALL' | PacketDirection>('ALL');
  const [stateFilter, setStateFilter] = useState<'ALL' | ProtocolState>('ALL');
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [selectedPacket, setSelectedPacket] = useState<PacketLogEntry | null>(null);

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    onSetPaused(next);
  };

  const clearPackets = async () => {
    onClearLocal();
    setSelectedPacket(null);
    await apiFetch('/api/packets/clear', { method: 'POST' });
  };

  const testMalformed = async () => {
    await apiFetch('/api/probe/malformed', { method: 'POST' });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...packets]
      .reverse()
      .filter((p) => {
        if (dirFilter !== 'ALL' && p.direction !== dirFilter) return false;
        if (stateFilter !== 'ALL' && p.state !== stateFilter) return false;
        if (
          q &&
          !p.packetName.toLowerCase().includes(q) &&
          !p.packetHexId.toLowerCase().includes(q) &&
          !p.summary.toLowerCase().includes(q) &&
          !(p.playerName ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      });
  }, [packets, dirFilter, stateFilter, search]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 h-[calc(100vh-8.5rem)]">
      <div className={`${selectedPacket ? 'xl:col-span-8' : 'xl:col-span-12'} bg-[#111620] border border-slate-800/80 rounded-lg flex flex-col overflow-hidden`}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-[#0b0e14] rounded-md border border-slate-800/80">
              {(['ALL', 'INBOUND', 'OUTBOUND', 'SHIELD_DROP'] as const).map((dir) => (
                <button
                  key={dir}
                  onClick={() => setDirFilter(dir)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    dirFilter === dir
                      ? dir === 'SHIELD_DROP'
                        ? 'bg-rose-950/70 text-rose-300'
                        : 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {dir === 'SHIELD_DROP' ? 'Shield Drops' : dir}
                </button>
              ))}
            </div>

            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as 'ALL' | ProtocolState)}
              className="px-2.5 py-1.5 text-xs bg-[#0b0e14] border border-slate-800 rounded-md text-slate-300 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All States</option>
              <option value="HANDSHAKE">HANDSHAKE</option>
              <option value="STATUS">STATUS</option>
              <option value="LOGIN">LOGIN</option>
              <option value="CONFIGURATION">CONFIGURATION</option>
              <option value="PLAY">PLAY</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ID or name..."
                className="pl-8 pr-3 py-1.5 text-xs bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 w-44"
              />
            </div>
            <button
              onClick={testMalformed}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Inject Malformed
            </button>
            <button
              onClick={togglePause}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#0b0e14] hover:bg-slate-800 text-slate-200 border border-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={clearPackets}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#0b0e14] hover:bg-slate-800 text-slate-300 border border-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        </div>

        {/* Stream Table */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No Minecraft packets captured yet. Trigger a Status Ping or connect a player on port 25565.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-[#0b0e14] border-b border-slate-800/80 text-slate-400 z-10">
                <tr>
                  <th className="py-2.5 px-3 font-medium">Time</th>
                  <th className="py-2.5 px-3 font-medium">Dir</th>
                  <th className="py-2.5 px-3 font-medium">State</th>
                  <th className="py-2.5 px-3 font-medium">ID</th>
                  <th className="py-2.5 px-3 font-medium">Packet Name</th>
                  <th className="py-2.5 px-3 font-medium text-right">Size</th>
                  <th className="py-2.5 px-3 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono">
                {filtered.map((pkt) => {
                  const isDrop = pkt.direction === 'SHIELD_DROP';
                  const isSelected = selectedPacket?.id === pkt.id;
                  const timeStr = new Date(pkt.timestamp).toLocaleTimeString('en-GB', { hour12: false });
                  return (
                    <tr
                      key={pkt.id}
                      onClick={() => setSelectedPacket(pkt)}
                      className={`cursor-pointer transition-colors ${
                        isDrop
                          ? 'bg-rose-950/35 hover:bg-rose-950/55 text-rose-200'
                          : isSelected
                            ? 'bg-emerald-950/30 text-slate-100'
                            : 'hover:bg-slate-800/35 text-slate-300'
                      }`}
                    >
                      <td className="py-2 px-3 tabular-nums text-slate-500">{timeStr}</td>
                      <td className="py-2 px-3">
                        <span
                          className={
                            isDrop
                              ? 'text-rose-400 font-semibold'
                              : pkt.direction === 'INBOUND'
                                ? 'text-sky-400'
                                : 'text-emerald-400'
                          }
                        >
                          {isDrop ? 'DROP' : pkt.direction === 'INBOUND' ? 'IN' : 'OUT'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-400">{pkt.state}</td>
                      <td className="py-2 px-3 tabular-nums text-slate-200">{pkt.packetHexId}</td>
                      <td className="py-2 px-3 text-slate-100">{pkt.packetName}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-slate-400">
                        {pkt.sizeBytes}B{pkt.compressed ? ' · Z' : ''}
                      </td>
                      <td className="py-2 px-3 font-sans truncate max-w-xs text-slate-300">
                        {pkt.error ? `Error: ${pkt.error}` : pkt.summary}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Packet Detail Drawer */}
      {selectedPacket && (
        <div className="xl:col-span-4 bg-[#111620] border border-slate-800/80 rounded-lg p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-100 font-mono">{selectedPacket.packetName}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedPacket.direction} · {selectedPacket.state} · {selectedPacket.packetHexId}
              </p>
            </div>
            <button
              onClick={() => setSelectedPacket(null)}
              className="text-xs text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="border-t border-slate-800/80 pt-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Connection</span>
              <span className="font-mono text-slate-200">
                {selectedPacket.playerName ?? selectedPacket.connectionId}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Payload Size</span>
              <span className="font-mono tabular-nums text-slate-200">{selectedPacket.sizeBytes} bytes</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Zlib Compressed</span>
              <span className="font-mono text-slate-200">{selectedPacket.compressed ? 'Yes' : 'No'}</span>
            </div>
          </div>

          {selectedPacket.error && (
            <div className="p-3 rounded bg-rose-950/40 border border-rose-900/60 text-xs font-mono text-rose-200">
              {selectedPacket.error}
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-slate-400 mb-1.5">Decoded Summary</div>
            <div className="p-3 rounded bg-[#0b0e14] border border-slate-800 text-xs font-mono text-slate-200 break-all">
              {selectedPacket.summary}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-400 mb-1.5">Hex Frame Preview</div>
            <div className="p-3 rounded bg-[#0b0e14] border border-slate-800 text-xs font-mono text-emerald-300 break-all leading-relaxed">
              {selectedPacket.hexPreview.match(/.{1,2}/g)?.join(' ') || '(empty payload)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
