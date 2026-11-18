import { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import type { Difficulty, GameMode, ServerConfig } from '../shared/types.ts';

interface SettingsViewProps {
  config: ServerConfig | null;
  onToast: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

export function SettingsView({ config, onToast }: SettingsViewProps) {
  const [form, setForm] = useState<ServerConfig | null>(config);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  if (!form) {
    return (
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-6 text-xs text-slate-400">
        Loading config.json...
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setForm(data.config);
      onToast('success', 'Settings Saved', 'config.json updated and applied to running engine.');
    } catch (err) {
      onToast('error', 'Save Failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Server Configuration (config.json)</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Changes persist directly to disk and apply immediately to Protocol 777 status responses and gameplay.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => config && setForm(config)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Applying...' : 'Save & Apply'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
          <div className="md:col-span-2">
            <label className="block font-medium text-slate-300 mb-1.5">Server MOTD</label>
            <input
              type="text"
              value={form.motd}
              onChange={(e) => setForm({ ...form, motd: e.target.value })}
              className="w-full px-3 py-2 bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">TCP Server Port</label>
            <input
              type="number"
              min={1024}
              max={65535}
              value={form.port}
              onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Max Players</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={form.maxPlayers}
              onChange={(e) => setForm({ ...form, maxPlayers: Number(e.target.value) })}
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">View Distance (Chunks)</label>
            <input
              type="number"
              min={2}
              max={16}
              value={form.viewDistance}
              onChange={(e) => setForm({ ...form, viewDistance: Number(e.target.value) })}
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Simulation Distance (Chunks)</label>
            <input
              type="number"
              min={2}
              max={16}
              value={form.simulationDistance}
              onChange={(e) => setForm({ ...form, simulationDistance: Number(e.target.value) })}
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Default GameMode</label>
            <select
              value={form.gamemode}
              onChange={(e) => setForm({ ...form, gamemode: e.target.value as GameMode })}
              className="w-full px-3 py-2 bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="survival">Survival</option>
              <option value="creative">Creative</option>
              <option value="adventure">Adventure</option>
              <option value="spectator">Spectator</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Difficulty</label>
            <select
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}
              className="w-full px-3 py-2 bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="peaceful">Peaceful</option>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">
              Zlib Compression Threshold (Bytes, -1 to disable)
            </label>
            <input
              type="number"
              min={-1}
              max={65535}
              value={form.compressionThreshold}
              onChange={(e) => setForm({ ...form, compressionThreshold: Number(e.target.value) })}
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">World Generator Type</label>
            <select
              value={form.worldType}
              onChange={(e) => setForm({ ...form, worldType: e.target.value as 'superflat' | 'void' })}
              className="w-full px-3 py-2 bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="superflat">Superflat (Grass + Dirt + Stone + Bedrock)</option>
              <option value="void">Void (Spawn Platform Only)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">
              Packet Shield Max Packet Size (Bytes)
            </label>
            <input
              type="number"
              min={4096}
              max={16777216}
              value={form.maxPacketSize}
              onChange={(e) => setForm({ ...form, maxPacketSize: Number(e.target.value) })}
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={form.onlineMode}
                onChange={(e) => setForm({ ...form, onlineMode: e.target.checked })}
                className="rounded border-slate-700 bg-[#0b0e14] text-emerald-500"
              />
              Online Mode (Mojang UUID)
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={form.spawnProtection}
                onChange={(e) => setForm({ ...form, spawnProtection: e.target.checked })}
                className="rounded border-slate-700 bg-[#0b0e14] text-emerald-500"
              />
              Spawn Protection
            </label>
          </div>
        </div>
      </div>
    </form>
  );
}
