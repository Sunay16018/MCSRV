import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import type { Difficulty, GameMode, NetworkInfo, ServerConfig } from '../shared/types.ts';
import { apiFetch, setStoredPanelToken } from '../hooks/useServerSocket.ts';

interface SettingsViewProps {
  config: ServerConfig | null;
  networkInfo: NetworkInfo | null;
  onToast: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

export function SettingsView({ config, networkInfo, onToast }: SettingsViewProps) {
  const [form, setForm] = useState<ServerConfig | null>(config);
  const [newIpInput, setNewIpInput] = useState('');
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
      const res = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setForm(data.config);
      if (data.config?.security?.protectWebPanel && data.config?.security?.panelAccessToken) {
        setStoredPanelToken(data.config.security.panelAccessToken);
      }
      onToast('success', 'Settings Saved', 'config.json updated and applied to running engine.');
    } catch (err) {
      onToast('error', 'Save Failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addAllowedIp = (ip: string) => {
    const clean = ip.trim();
    if (!clean) return;
    if (form.security.allowedIps.includes(clean)) return;
    setForm({
      ...form,
      security: {
        ...form.security,
        allowedIps: [...form.security.allowedIps, clean],
      },
    });
    setNewIpInput('');
  };

  const removeAllowedIp = (ip: string) => {
    setForm({
      ...form,
      security: {
        ...form.security,
        allowedIps: form.security.allowedIps.filter((item) => item !== ip),
      },
    });
  };

  const generateToken = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    setForm({
      ...form,
      security: {
        ...form.security,
        protectWebPanel: true,
        panelAccessToken: hex,
      },
    });
  };

  const copyToken = async () => {
    if (!form.security.panelAccessToken) return;
    await navigator.clipboard.writeText(form.security.panelAccessToken);
    onToast('success', 'Access Token Copied', 'Save this token before closing the panel.');
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-4 sm:space-y-6">
      {/* Core Gameplay & Network Config */}
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Server Configuration (config.json)</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Changes persist directly to disk and apply immediately to 1.21–26.3 status responses and gameplay.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => config && setForm(config)}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Applying...' : 'Save & Apply'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 text-xs">
          <div className="md:col-span-2">
            <label className="block font-medium text-slate-300 mb-1.5">Server MOTD</label>
            <input
              type="text"
              value={form.motd}
              onChange={(e) => setForm({ ...form, motd: e.target.value })}
              className="w-full px-3 py-2 bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block font-medium text-slate-300 mb-1.5">
              AWS Public IP / Domain Override (shown on Dashboard)
            </label>
            <input
              type="text"
              value={form.publicHost}
              onChange={(e) => setForm({ ...form, publicHost: e.target.value })}
              placeholder={`Auto-detected (${networkInfo?.detectedIp ?? '127.0.0.1'}) — e.g. 54.123.45.67`}
              className="w-full px-3 py-2 font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
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

          <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-2">
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

      {/* AWS Firewall, IP Allowlist & Panel Auth Hardening */}
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-base font-semibold text-slate-100">AWS Security & IP Allowlist</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Restrict web panel & Minecraft port {form.port} to your own IP/CIDR and protect API/WebSocket routes with an access token.
              </p>
            </div>
          </div>
          {networkInfo?.clientIp && (
            <button
              type="button"
              onClick={() => addAllowedIp(networkInfo.clientIp)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add My IP ({networkInfo.clientIp})
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 text-xs">
          <div className="space-y-2.5 md:col-span-2">
            <label className="flex items-start sm:items-center gap-2.5 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={form.security.ipWhitelistEnabled}
                onChange={(e) =>
                  setForm({
                    ...form,
                    security: { ...form.security, ipWhitelistEnabled: e.target.checked },
                  })
                }
                className="mt-0.5 sm:mt-0 rounded border-slate-700 bg-[#0b0e14] text-emerald-500 shrink-0"
              />
              <span>Enforce IP Allowlist on Web Control Panel (Port 3000)</span>
            </label>

            <label className="flex items-start sm:items-center gap-2.5 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={form.security.enforceMinecraftIpWhitelist}
                onChange={(e) =>
                  setForm({
                    ...form,
                    security: { ...form.security, enforceMinecraftIpWhitelist: e.target.checked },
                  })
                }
                className="mt-0.5 sm:mt-0 rounded border-slate-700 bg-[#0b0e14] text-emerald-500 shrink-0"
              />
              <span>Enforce IP Allowlist on Minecraft TCP Server (Port {form.port})</span>
            </label>
          </div>

          <div className="md:col-span-2 space-y-2">
            <label className="block font-medium text-slate-300">
              Allowed IPs & CIDR Ranges (127.0.0.1 is always permitted locally)
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newIpInput}
                onChange={(e) => setNewIpInput(e.target.value)}
                placeholder="e.g. 203.0.113.45 or 203.0.113.0/24"
                className="flex-1 min-w-0 px-3 py-2 font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => addAllowedIp(newIpInput)}
                className="px-3.5 py-2 rounded-md font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Add Rule
              </button>
            </div>
            <div className="divide-y divide-slate-800/60 border border-slate-800/80 rounded-md bg-[#0b0e14]">
              {form.security.allowedIps.map((ip) => (
                <div key={ip} className="px-3 py-2 flex items-center justify-between font-mono text-slate-200">
                  <span className="truncate">{ip}</span>
                  <button
                    type="button"
                    onClick={() => removeAllowedIp(ip)}
                    className="text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 pt-2 border-t border-slate-800/80 space-y-3">
            <label className="flex items-start sm:items-center gap-2.5 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={form.security.protectWebPanel}
                onChange={(e) =>
                  setForm({
                    ...form,
                    security: { ...form.security, protectWebPanel: e.target.checked },
                  })
                }
                className="mt-0.5 sm:mt-0 rounded border-slate-700 bg-[#0b0e14] text-emerald-500 shrink-0"
              />
              <span>Require Panel Access Token for Web UI & WebSocket (Recommended for AWS)</span>
            </label>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={form.security.panelAccessToken}
                onChange={(e) =>
                  setForm({
                    ...form,
                    security: { ...form.security, panelAccessToken: e.target.value },
                  })
                }
                placeholder="Click Generate Token or enter custom secret key..."
                className="flex-1 min-w-0 px-3 py-2 font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <div className="grid grid-cols-2 sm:flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={generateToken}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  Generate
                </button>
                <button
                  type="button"
                  onClick={copyToken}
                  disabled={!form.security.panelAccessToken}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Max Concurrent TCP Connections / IP</label>
            <input
              type="number"
              min={1}
              max={100}
              value={form.security.maxConnectionsPerIp}
              onChange={(e) =>
                setForm({
                  ...form,
                  security: { ...form.security, maxConnectionsPerIp: Number(e.target.value) },
                })
              }
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-300 mb-1.5">Max Handshakes / Minute / IP (Anti-Flood)</label>
            <input
              type="number"
              min={5}
              max={600}
              value={form.security.maxHandshakesPerMinute}
              onChange={(e) =>
                setForm({
                  ...form,
                  security: { ...form.security, maxHandshakesPerMinute: Number(e.target.value) },
                })
              }
              className="w-full px-3 py-2 font-mono tabular-nums bg-[#0b0e14] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </div>
    </form>
  );
}
