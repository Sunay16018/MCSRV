import { useMemo, useState } from 'react';
import { ArrowLeft, Eraser, Pause, Play, Search, ShieldAlert, X } from 'lucide-react';
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
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 h-[calc(100dvh-7rem)] sm:h-[calc(100dvh-8rem)]">
      {/* Main Stream Panel (hidden on mobile when inspecting a packet) */}
      <div
        className={`${selectedPacket ? 'hidden xl:flex xl:col-span-8' : 'flex xl:col-span-12'} bg-[#111620] border border-slate-800/80 rounded-lg flex-col overflow-hidden`}
      >
        {/* Toolbar */}
        <div className="flex flex-col gap-2.5 px-3 sm:px-4 py-3 border-b border-slate-800/80 bg-[#0e131c]">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-[#0b0e14] rounded-md border border-slate-800/80 overflow-x-auto max-w-full">
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

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-initial min-w-36">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ID or name..."
                  className="w-full sm:w-44 pl-8 pr-3 py-1.5 text-xs bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                onClick={testMalformed}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Inject Malformed</span>
                <span className="sm:hidden">Shield Test</span>
              </button>
              <button
                onClick={togglePause}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-[#0b0e14] hover:bg-slate-800 text-slate-200 border border-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                <span>{paused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                onClick={clearPackets}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-[#0b0e14] hover:bg-slate-800 text-slate-300 border border-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </div>
          </div>
        </div>

        {/* Stream Body */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 sm:p-10 text-center text-xs text-slate-500">
              No Minecraft packets captured yet. Trigger a Status Ping or connect a player on port 25565.
            </div>
          ) : (
            <>
              {/* Mobile Packet Cards */}
              <div className="md:hidden divide-y divide-slate-800/60 font-mono text-xs">
                {filtered.map((pkt) => {
                  const isDrop = pkt.direction === 'SHIELD_DROP';
                  const timeStr = new Date(pkt.timestamp).toLocaleTimeString('en-GB', { hour12: false });
                  return (
                    <div
                      key={pkt.id}
                      onClick={() => setSelectedPacket(pkt)}
                      className={`p-3 space-y-1 cursor-pointer ${
                        isDrop ? 'bg-rose-950/35 text-rose-200' : 'hover:bg-slate-800/35 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`font-semibold ${
                              isDrop
                                ? 'text-rose-400'
                                : pkt.direction === 'INBOUND'
                                  ? 'text-sky-400'
                                  : 'text-emerald-400'
                            }`}
                          >
                            {isDrop ? 'DROP' : pkt.direction === 'INBOUND' ? 'IN' : 'OUT'}
                          </span>
                          <span className="text-slate-400">{pkt.packetHexId}</span>
                          <span className="text-slate-100 truncate">{pkt.packetName}</span>
                        </div>
                        <span className="text-slate-500 tabular-nums shrink-0">{timeStr}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] font-sans text-slate-400">
                        <span className="truncate">{pkt.error ? `Error: ${pkt.error}` : pkt.summary}</span>
                        <span className="font-mono tabular-nums shrink-0">{pkt.sizeBytes}B</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Packet Table */}
              <table className="hidden md:table w-full text-left border-collapse text-xs">
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
            </>
          )}
        </div>
      </div>

      {/* Packet Detail Drawer */}
      {selectedPacket && (
        <div className="xl:col-span-4 bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <button
                onClick={() => setSelectedPacket(null)}
                className="xl:hidden inline-flex items-center gap-1.5 text-xs text-emerald-400 mb-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Stream
              </button>
              <h3 className="text-sm font-semibold text-slate-100 font-mono truncate">{selectedPacket.packetName}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedPacket.direction} · {selectedPacket.state} · {selectedPacket.packetHexId}
              </p>
            </div>
            <button
              onClick={() => setSelectedPacket(null)}
              className="hidden xl:inline-flex p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
              aria-label="Close detail"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="border-t border-slate-800/80 pt-3 space-y-2 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Connection</span>
              <span className="font-mono text-slate-200 truncate">
                {selectedPacket.playerName ?? selectedPacket.connectionId}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Payload Size</span>
              <span className="font-mono tabular-nums text-slate-200">{selectedPacket.sizeBytes} bytes</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Zlib Compressed</span>
              <span className="font-mono text-slate-200">{selectedPacket.compressed ? 'Yes' : 'No'}</span>
            </div>
          </div>

          {selectedPacket.error && (
            <div className="p-3 rounded bg-rose-950/40 border border-rose-900/60 text-xs font-mono text-rose-200 break-words">
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
