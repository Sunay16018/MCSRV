import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, Copy, Eraser, Search, Send } from 'lucide-react';
import type { ConsoleLog, LogLevel } from '../shared/types.ts';
import { apiFetch } from '../hooks/useServerSocket.ts';

interface ConsoleViewProps {
  logs: ConsoleLog[];
  onClearLocal: () => void;
  onToast?: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

const LEVELS: Array<'ALL' | LogLevel> = ['ALL', 'INFO', 'WARN', 'ERROR', 'CHAT', 'PLUGIN', 'PROTOCOL'];
const QUICK_COMMANDS = ['help', 'list', 'plugins', 'viabackwards', 'reload'];

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

export function ConsoleView({ logs, onClearLocal, onToast }: ConsoleViewProps) {
  const [levelFilter, setLevelFilter] = useState<'ALL' | LogLevel>('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
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

  const dispatchCommand = async (rawCmd: string) => {
    const trimmed = rawCmd.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setCmdHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIdx(-1);

    try {
      await apiFetch('/api/console/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      });
    } finally {
      setSending(false);
    }
  };

  const submitCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = commandInput;
    setCommandInput('');
    await dispatchCommand(val);
  };

  const copyLogs = async () => {
    const text = filteredLogs
      .map((l) => {
        const t = new Date(l.timestamp).toLocaleTimeString('en-GB', { hour12: false });
        return `${t} [${l.level}] [${l.source}] ${l.message}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast?.('success', 'Logs Copied', `Copied ${filteredLogs.length} console line(s).`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast?.('warn', 'Clipboard Unavailable', 'Unable to access clipboard.');
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
    <div className="flex flex-col h-[calc(100dvh-7rem)] sm:h-[calc(100dvh-8rem)] bg-[#111620] border border-slate-800/80 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-2.5 px-3 sm:px-4 py-3 border-b border-slate-800/80 bg-[#0e131c]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
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

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:flex-initial min-w-40">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter logs..."
                className="w-full sm:w-48 pl-8 pr-3 py-1.5 text-xs bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              onClick={copyLogs}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#0b0e14] text-slate-300 hover:text-slate-100 border border-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={() => setAutoScroll((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoScroll
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
                  : 'bg-[#0b0e14] text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Auto-scroll</span>
            </button>

            <button
              onClick={onClearLocal}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#0b0e14] text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>

        {/* Quick Commands */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px]">
          <span className="text-slate-500 shrink-0 mr-1">Quick:</span>
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => void dispatchCommand(cmd)}
              className="px-2 py-0.5 rounded font-mono bg-[#0b0e14] hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              /{cmd}
            </button>
          ))}
        </div>
      </div>

      {/* Live Log Viewport */}
      <div className="flex-1 overflow-y-auto bg-[#0b0e14] p-3 sm:p-4 font-mono text-[11px] sm:text-xs leading-5 sm:leading-6 space-y-1.5 sm:space-y-0.5">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 py-8 text-center">No log entries match the active filter.</div>
        ) : (
          filteredLogs.map((log) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString('en-GB', { hour12: false });
            return (
              <div
                key={log.id}
                className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-2.5 hover:bg-slate-900/40 px-1.5 py-1 sm:py-0 rounded"
              >
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-600 tabular-nums">{timeStr}</span>
                  <span className={`font-semibold sm:w-16 ${levelClass(log.level)}`}>[{log.level}]</span>
                  <span className="text-slate-400">[{log.source}]</span>
                </div>
                <span className="text-slate-200 break-words min-w-0">{log.message}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Command Input */}
      <form
        onSubmit={submitCommand}
        className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-slate-800/80 bg-[#0e131c]"
      >
        <input
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command (help, list, plugins, viabackwards)..."
          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={!commandInput.trim() || sending}
          className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Execute</span>
        </button>
      </form>
    </div>
  );
}
