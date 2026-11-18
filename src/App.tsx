import { useState } from 'react';
import {
  Activity,
  Box,
  FolderCode,
  KeyRound,
  Menu,
  Network,
  Play,
  Plug,
  RotateCw,
  Settings,
  Square,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, useServerSocket } from './hooks/useServerSocket.ts';
import { DashboardView } from './components/DashboardView.tsx';
import { ConsoleView } from './components/ConsoleView.tsx';
import { FilesView } from './components/FilesView.tsx';
import { PluginsView } from './components/PluginsView.tsx';
import { PlayersView } from './components/PlayersView.tsx';
import { PacketInspectorView } from './components/PacketInspectorView.tsx';
import { SettingsView } from './components/SettingsView.tsx';

type PageId =
  | 'dashboard'
  | 'console'
  | 'files'
  | 'plugins'
  | 'players'
  | 'packets'
  | 'settings';

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof Activity }> = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'console', label: 'Console', icon: Terminal },
  { id: 'files', label: 'Files', icon: FolderCode },
  { id: 'plugins', label: 'Plugins', icon: Plug },
  { id: 'players', label: 'Players', icon: Users },
  { id: 'packets', label: 'Packet Inspector', icon: Network },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [ideFileTarget, setIdeFileTarget] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');

  const {
    connected,
    loading,
    authRequired,
    clientIp,
    metrics,
    history,
    logs,
    players,
    bans,
    packets,
    plugins,
    config,
    networkInfo,
    toasts,
    pushToast,
    dismissToast,
    setPacketsPaused,
    clearPacketsLocal,
    clearLogsLocal,
    unlockWithToken,
  } = useServerSocket();

  const handleServerAction = async (action: 'start' | 'stop' | 'restart') => {
    try {
      const res = await apiFetch(`/api/server/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to ${action} server`);
      pushToast(
        'success',
        action === 'start' ? 'Server Started' : action === 'stop' ? 'Server Stopped' : 'Server Restarted',
        `AetherCore 26.3 ${action} operation completed.`
      );
    } catch (err) {
      pushToast('error', 'Server Error', (err as Error).message);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setTokenError('');
    const ok = await unlockWithToken(tokenInput.trim());
    if (!ok) {
      setTokenError('Invalid panel access token.');
    }
  };

  const openInIde = (filePath: string) => {
    setIdeFileTarget(filePath);
    setActivePage('files');
  };

  if (authRequired) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#0b0e14] text-slate-100 p-4">
        <form
          onSubmit={handleUnlock}
          className="w-full max-w-md bg-[#111620] border border-slate-800/80 rounded-lg p-6 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-emerald-400" />
            <h1 className="font-display text-lg font-semibold">AetherCore Panel Access</h1>
          </div>
          <p className="text-xs text-slate-400">
            This control panel is protected by an access token. Connected IP:{' '}
            <span className="font-mono text-slate-300">{clientIp}</span>
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Enter Panel Access Token..."
            autoFocus
            className="w-full px-3 py-2 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
          />
          {tokenError && <div className="text-xs text-rose-400">{tokenError}</div>}
          <button
            type="submit"
            className="w-full py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
          >
            Unlock Control Panel
          </button>
        </form>
      </div>
    );
  }

  const activeNav = NAV_ITEMS.find((n) => n.id === activePage) ?? NAV_ITEMS[0];
  const isRunning = metrics?.status === 'running';

  return (
    <div className="h-dvh flex bg-[#0b0e14] text-slate-100 overflow-hidden">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/65 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (248px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-62 bg-[#0e131c] border-r border-slate-800/80 flex flex-col transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <Box className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="font-display font-bold text-base tracking-tight text-slate-100 whitespace-nowrap">
              AetherCore
            </span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'files') {
                    setIdeFileTarget(null);
                  }
                  setActivePage(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/40'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                  {item.label}
                </span>
                {item.id === 'players' && (
                  <span className="font-mono text-xs tabular-nums text-slate-400">
                    {players.length}
                  </span>
                )}
                {item.id === 'plugins' && (
                  <span className="font-mono text-xs tabular-nums text-slate-400">
                    {plugins.filter((p) => p.enabled).length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 text-xs text-slate-400 space-y-1 shrink-0">
          <div className="flex items-center justify-between">
            <span>Versions</span>
            <span className="font-mono text-slate-300">{metrics?.supportedVersions ?? '1.21 – 26.3'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>TCP Port</span>
            <span className="font-mono tabular-nums text-slate-300">{metrics?.port ?? 25565}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>WebSocket</span>
            <span className={connected ? 'text-emerald-400' : 'text-amber-400'}>
              {connected ? 'Connected' : 'Reconnecting'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Header Bar */}
        <header className="h-14 px-3 sm:px-5 border-b border-slate-800/80 bg-[#0e131c]/90 flex items-center justify-between gap-2 sm:gap-6 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded text-slate-400 hover:text-slate-100 cursor-pointer shrink-0"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden md:inline text-slate-500 whitespace-nowrap">Server Engine</span>
              <span className="hidden md:inline text-slate-600">/</span>
              <h1 className="font-display font-semibold text-slate-100 truncate">
                {activeNav.label}
              </h1>
              <span className="hidden sm:inline text-slate-600">·</span>
              <span
                className={`hidden sm:inline text-xs font-medium whitespace-nowrap ${
                  isRunning ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {isRunning ? `Online (${metrics?.tps?.toFixed(1) ?? '20.0'} TPS)` : metrics?.status ?? 'Stopped'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isRunning ? (
              <>
                <button
                  onClick={() => handleServerAction('restart')}
                  className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  aria-label="Restart server"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Restart</span>
                </button>
                <button
                  onClick={() => handleServerAction('stop')}
                  className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border border-rose-800/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  aria-label="Stop server"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Stop</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => handleServerAction('start')}
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Start</span>
              </button>
            )}
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="flex-1 p-3 sm:p-5 overflow-y-auto min-h-0">
          {loading ? (
            <div className="p-8 text-xs text-slate-400">Connecting to AetherCore control plane...</div>
          ) : (
            <>
              {activePage === 'dashboard' && (
                <DashboardView
                  metrics={metrics}
                  history={history}
                  config={config}
                  networkInfo={networkInfo}
                  onServerAction={handleServerAction}
                  onToast={pushToast}
                />
              )}
              {activePage === 'console' && (
                <ConsoleView logs={logs} onClearLocal={clearLogsLocal} onToast={pushToast} />
              )}
              {activePage === 'files' && (
                <FilesView
                  initialFilePath={ideFileTarget}
                  onClearInitialFile={() => setIdeFileTarget(null)}
                  onToast={pushToast}
                />
              )}
              {activePage === 'plugins' && (
                <PluginsView plugins={plugins} onEditFile={openInIde} onToast={pushToast} />
              )}
              {activePage === 'players' && (
                <PlayersView players={players} bans={bans} onToast={pushToast} />
              )}
              {activePage === 'packets' && (
                <PacketInspectorView
                  packets={packets}
                  onSetPaused={setPacketsPaused}
                  onClearLocal={clearPacketsLocal}
                />
              )}
              {activePage === 'settings' && (
                <SettingsView config={config} networkInfo={networkInfo} onToast={pushToast} />
              )}
            </>
          )}
        </main>
      </div>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:bottom-4 sm:right-4 z-50 flex flex-col gap-2 sm:max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-4 py-3 rounded-lg border text-xs shadow-lg flex items-start justify-between gap-3 ${
                t.level === 'error'
                  ? 'bg-rose-950/95 border-rose-800 text-rose-100'
                  : t.level === 'warn'
                    ? 'bg-amber-950/95 border-amber-800 text-amber-100'
                    : 'bg-[#131b26] border-emerald-700/70 text-slate-100'
              }`}
            >
              <div className="min-w-0">
                <div className="font-semibold">{t.title}</div>
                <div className="text-slate-300 mt-0.5 break-words">{t.message}</div>
              </div>
              <button
                onClick={() => dismissToast(t.id)}
                className="text-slate-400 hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
