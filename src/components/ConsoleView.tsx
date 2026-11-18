import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Eraser, Search, Send } from 'lucide-react';
import type { ConsoleLog, LogLevel } from '../shared/types.ts';

interface ConsoleViewProps {
  logs: ConsoleLog[];
  onClearLocal: () => void;
}

const LEVELS: Array<'ALL' | LogLevel> = ['ALL', 'INFO', 'WARN', 'ERROR', 'CHAT', 'PLUGIN', 'PROTOCOL'];

function levelClass(level: LogLevel): string {
  switch (level) {
    case 'ERROR':
      return 'text-rose-400';
    case 'WARN':
      return 'text-amber-400';
    case 'CHAT':
      return 'text-sky-300';
    case 'PLUGIN':
      return 'text-emerald-400';
    case 'PROTOCOL':
      return 'text-indigo-300';
    default:
      return 'text-slate-400';
  }
}

export function ConsoleView({ logs, onClearLocal }: ConsoleViewProps) {
  const [levelFilter, setLevelFilter] = useState<'ALL' | LogLevel>('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [commandInput, setCommandInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [sending, setSending] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (levelFilter !== 'ALL' && log.level !== levelFilter) return false;
      if (q && !log.message.toLowerCase().includes(q) && !log.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, levelFilter, search]);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [filteredLogs.length, autoScroll]);

  const submitCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandInput.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setCmdHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIdx(-1);
    setCommandInput('');

    try {
      await fetch('/api/console/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const nextIdx = Math.min(cmdHistory.length - 1, historyIdx + 1);
      setHistoryIdx(nextIdx);
      setCommandInput(cmdHistory[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setCommandInput('');
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setCommandInput(cmdHistory[nextIdx]);
      }
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] bg-[#111620] border border-slate-800/80 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
        <div className="flex items-center gap-1 p-1 bg-[#0b0e14] rounded-md border border-slate-800/80 overflow-x-auto">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                levelFilter === lvl
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter logs..."
              className="pl-8 pr-3 py-1.5 text-xs bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 w-48"
            />
          </div>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              autoScroll
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
                : 'bg-[#0b0e14] text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Auto-scroll
          </button>
          <button
            onClick={onClearLocal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#0b0e14] text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Eraser className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Live Log Viewport */}
      <div className="flex-1 overflow-y-auto bg-[#0b0e14] p-4 font-mono text-xs leading-6 space-y-0.5">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 py-8 text-center">No log entries match the active filter.</div>
        ) : (
          filteredLogs.map((log) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString('en-GB', { hour12: false });
            return (
              <div key={log.id} className="flex items-start gap-2.5 hover:bg-slate-900/40 px-1.5 rounded">
                <span className="text-slate-600 tabular-nums shrink-0">{timeStr}</span>
                <span className={`font-semibold w-16 shrink-0 ${levelClass(log.level)}`}>[{log.level}]</span>
                <span className="text-slate-400 shrink-0">[{log.source}]</span>
                <span className="text-slate-200 break-all">{log.message}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Command Input */}
      <form onSubmit={submitCommand} className="flex items-center gap-2 px-4 py-3 border-t border-slate-800/80 bg-[#111620]">
        <input
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter server command (e.g. help, list, plugins, say Hello, fly Player, reload)..."
          className="flex-1 px-3 py-2 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={!commandInput.trim() || sending}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          Execute
        </button>
      </form>
    </div>
  );
}
