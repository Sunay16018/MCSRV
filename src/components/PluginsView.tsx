import { useState } from 'react';
import { Code2, Plus, Power, RefreshCw } from 'lucide-react';
import type { PluginMetadata } from '../shared/types.ts';
import { apiFetch } from '../hooks/useServerSocket.ts';

interface PluginsViewProps {
  plugins: PluginMetadata[];
  onEditFile: (path: string) => void;
  onToast: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

export function PluginsView({ plugins, onEditFile, onToast }: PluginsViewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const reloadAll = async () => {
    setBusyId('ALL');
    try {
      const res = await apiFetch('/api/plugins/reload-all', { method: 'POST' });
      if (!res.ok) throw new Error('Reload failed');
      onToast('success', 'Plugins Reloaded', 'All plugins reloaded cleanly in memory.');
    } catch (err) {
      onToast('error', 'Reload Error', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const reloadOne = async (plugin: PluginMetadata) => {
    setBusyId(plugin.id);
    try {
      const res = await apiFetch(`/api/plugins/${encodeURIComponent(plugin.id)}/reload`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reload failed');
      onToast(
        data.plugin?.error ? 'error' : 'success',
        'Hot-Reload Complete',
        data.plugin?.error ? data.plugin.error : `${plugin.name} v${plugin.version} reloaded.`
      );
    } catch (err) {
      onToast('error', 'Hot-Reload Failed', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const togglePlugin = async (plugin: PluginMetadata) => {
    setBusyId(plugin.id);
    try {
      const res = await apiFetch(`/api/plugins/${encodeURIComponent(plugin.id)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !plugin.enabled }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      onToast(
        'success',
        !plugin.enabled ? 'Plugin Enabled' : 'Plugin Disabled',
        `${plugin.name} is now ${!plugin.enabled ? 'active' : 'disabled'}.`
      );
    } catch (err) {
      onToast('error', 'Error', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const createPlugin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusyId('CREATE');
    try {
      const res = await apiFetch('/api/plugins/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      setCreating(false);
      setNewName('');
      onToast('success', 'Plugin Created', `Created plugins/${data.filename} and loaded live.`);
      onEditFile(`plugins/${data.filename}`);
    } catch (err) {
      onToast('error', 'Create Failed', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Hot-Reload Plugin Manager</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {plugins.length} plugins in plugins/ · Save any plugin source file to trigger automatic Hot-Reload
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreating((v) => !v)}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Plugin
          </button>
          <button
            onClick={reloadAll}
            disabled={busyId !== null}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyId === 'ALL' ? 'animate-spin' : ''}`} />
            Reload All
          </button>
        </div>
      </div>

      {creating && (
        <form
          onSubmit={createPlugin}
          className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 flex flex-col sm:flex-row sm:items-end gap-3"
        >
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Plugin Filename (e.g. welcome_kit)
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my_custom_plugin"
              autoFocus
              className="w-full px-3 py-2 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!newName.trim() || busyId === 'CREATE'}
              className="flex-1 sm:flex-initial px-4 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              Scaffold & Load
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-2 rounded-md text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plugins.map((plugin) => (
          <div
            key={plugin.id}
            className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-5 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100 truncate">{plugin.name}</h3>
                  <div className="mt-1 text-xs text-slate-400 break-words">
                    v{plugin.version} · {plugin.author} · <span className="font-mono">{plugin.filename}</span>
                  </div>
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                    plugin.error
                      ? 'text-rose-400'
                      : plugin.enabled
                        ? 'text-emerald-400'
                        : 'text-slate-500'
                  }`}
                >
                  {plugin.error ? 'Error' : plugin.enabled ? 'Active' : 'Disabled'}
                </span>
              </div>

              <p className="mt-3 text-xs text-slate-300 leading-relaxed">{plugin.description}</p>

              {plugin.error && (
                <div className="mt-3 p-2.5 rounded bg-rose-950/40 border border-rose-900/60 text-xs font-mono text-rose-300 break-words">
                  {plugin.error}
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-400 space-y-1">
                <div className="break-words">
                  <span className="text-slate-500">Commands:</span>{' '}
                  <span className="font-mono text-slate-200">
                    {plugin.commands.length > 0 ? plugin.commands.join(' · ') : 'None'}
                  </span>
                </div>
                <div className="break-words">
                  <span className="text-slate-500">Event Hooks:</span>{' '}
                  <span className="font-mono text-slate-300">
                    {plugin.hooks.length > 0 ? plugin.hooks.join(' · ') : 'None'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 sm:flex flex-wrap items-center gap-2 pt-2">
              <button
                onClick={() => togglePlugin(plugin)}
                disabled={busyId === plugin.id}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  plugin.enabled
                    ? 'bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                {plugin.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => reloadOne(plugin)}
                disabled={busyId === plugin.id}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busyId === plugin.id ? 'animate-spin' : ''}`} />
                Reload
              </button>
              <button
                onClick={() => onEditFile(plugin.path)}
                className="inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5" />
                Source
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
