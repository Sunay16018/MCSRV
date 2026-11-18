import { useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  Cpu,
  Globe,
  HardDrive,
  Play,
  Radio,
  RotateCw,
  ShieldAlert,
  Square,
  UserPlus,
  Users,
  Wifi,
} from 'lucide-react';
import type { MetricSample, NetworkInfo, ServerConfig, ServerMetrics } from '../shared/types.ts';
import { apiFetch } from '../hooks/useServerSocket.ts';

interface DashboardViewProps {
  metrics: ServerMetrics | null;
  history: MetricSample[];
  config: ServerConfig | null;
  networkInfo: NetworkInfo | null;
  onServerAction: (action: 'start' | 'stop' | 'restart') => Promise<void>;
  onToast: (level: 'success' | 'warn' | 'error', title: string, message: string) => void;
}

function formatUptime(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface ChartSeriesProps {
  data: MetricSample[];
  accessor: (s: MetricSample) => number;
  maxValue: number;
  stroke: string;
  fill: string;
  unit: string;
  label: string;
  currentText: string;
  secondaryLabel?: string;
  secondaryAccessor?: (s: MetricSample) => number;
  secondaryMax?: number;
  secondaryStroke?: string;
  secondaryCurrentText?: string;
}

function TelemetrySvgChart({
  data,
  accessor,
  maxValue,
  stroke,
  fill,
  unit,
  label,
  currentText,
  secondaryLabel,
  secondaryAccessor,
  secondaryMax,
  secondaryStroke,
  secondaryCurrentText,
}: ChartSeriesProps) {
  const width = 560;
  const height = 160;
  const padX = 8;
  const padY = 14;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const samples = data.length > 1 ? data : [
    { timestamp: Date.now() - 1000, tps: 20, mspt: 0.4, ramMb: 80, cpuPercent: 0.5, players: 0 },
    { timestamp: Date.now(), tps: 20, mspt: 0.4, ramMb: 80, cpuPercent: 0.5, players: 0 },
  ];

  const buildPath = (fn: (s: MetricSample) => number, maxV: number) => {
    return samples
      .map((s, idx) => {
        const x = padX + (idx / (samples.length - 1)) * plotW;
        const clamped = Math.max(0, Math.min(maxV, fn(s)));
        const y = padY + plotH - (clamped / maxV) * plotH;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const primaryLine = buildPath(accessor, maxValue);
  const areaPath = `${primaryLine} L ${(padX + plotW).toFixed(1)} ${(padY + plotH).toFixed(1)} L ${padX} ${(padY + plotH).toFixed(1)} Z`;
  const secondaryLine =
    secondaryAccessor && secondaryMax ? buildPath(secondaryAccessor, secondaryMax) : null;

  return (
    <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3 sm:mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time 500ms telemetry stream · {samples.length} samples
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: stroke }} />
            <span className="text-slate-400">{label.split(' ')[0]}:</span>
            <span className="font-mono font-semibold text-slate-100">
              {currentText} {unit}
            </span>
          </div>
          {secondaryLabel && secondaryCurrentText && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: secondaryStroke }} />
              <span className="text-slate-400">{secondaryLabel}:</span>
              <span className="font-mono font-semibold text-slate-100">{secondaryCurrentText}</span>
            </div>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-32 sm:h-40 overflow-visible"
        role="img"
        aria-label={label}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padY + plotH * t;
          return (
            <line
              key={t}
              x1={padX}
              y1={y}
              x2={padX + plotW}
              y2={y}
              stroke="rgba(148, 163, 184, 0.08)"
              strokeDasharray="3 3"
            />
          );
        })}

        <path d={areaPath} fill={fill} />
        <path d={primaryLine} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        {secondaryLine && secondaryStroke && (
          <path
            d={secondaryLine}
            fill="none"
            stroke={secondaryStroke}
            strokeWidth="1.75"
            strokeDasharray="4 3"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}

export function DashboardView({
  metrics,
  history,
  config,
  networkInfo,
  onServerAction,
  onToast,
}: DashboardViewProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState(false);
  const [probeProtocol, setProbeProtocol] = useState<number>(777);
  const [probeStatusResult, setProbeStatusResult] = useState<{
    motd: string;
    versionName: string;
    protocol: number;
    onlinePlayers: number;
    maxPlayers: number;
    rttMs: number;
  } | null>(null);

  const isRunning = metrics?.status === 'running';
  const connectAddr = networkInfo?.connectAddress ?? `127.0.0.1:${metrics?.port ?? 25565}`;

  const copyConnectAddress = async () => {
    try {
      await navigator.clipboard.writeText(connectAddr);
      setCopiedIp(true);
      onToast('success', 'Server Address Copied', `${connectAddr} copied to clipboard.`);
      setTimeout(() => setCopiedIp(false), 2000);
    } catch {
      onToast('warn', 'Copy Manually', connectAddr);
    }
  };

  const triggerAction = async (action: 'start' | 'stop' | 'restart') => {
    setBusyAction(action);
    try {
      await onServerAction(action);
    } finally {
      setBusyAction(null);
    }
  };

  const runStatusPing = async () => {
    setBusyAction('ping');
    try {
      const res = await apiFetch('/api/probe/status', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ping failed');
      setProbeStatusResult(data.result);
      onToast(
        'success',
        'Status Ping Verified',
        `Protocol ${data.result.protocol} (${data.result.versionName}) responded in ${data.result.rttMs} ms`
      );
    } catch (err) {
      onToast('error', 'Status Ping Failed', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const spawnProbePlayer = async () => {
    setBusyAction('spawn');
    try {
      const res = await apiFetch('/api/probe/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: probeProtocol }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to spawn test player');
      onToast(
        'success',
        'Test Player Connected',
        `${data.username} joined on protocol ${data.protocolVersion} (Login -> Config -> Play)`
      );
    } catch (err) {
      onToast('error', 'Test Client Failed', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const testMalformedShield = async () => {
    setBusyAction('shield');
    try {
      await apiFetch('/api/probe/malformed', { method: 'POST' });
      onToast(
        'warn',
        'Crash-Proof Shield Tested',
        'Sent corrupted TCP frame to port 25565 — neutralized and logged in Packet Inspector.'
      );
    } catch (err) {
      onToast('error', 'Shield Test Error', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const tpsColor =
    !isRunning
      ? 'text-slate-400'
      : (metrics?.tps ?? 20) >= 19.0
        ? 'text-emerald-400'
        : (metrics?.tps ?? 20) >= 15.0
          ? 'text-amber-400'
          : 'text-rose-400';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Direct Minecraft Server Address Banner */}
      <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Globe className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-400">
              Minecraft Server Address · Versions {metrics?.supportedVersions ?? '1.21 – 26.3'} (ViaBackwards)
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
              <span className="text-base sm:text-xl font-mono font-semibold text-slate-100 tabular-nums break-all">
                {connectAddr}
              </span>
              <button
                onClick={copyConnectAddress}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedIp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedIp ? 'Copied' : 'Copy IP'}
              </button>
            </div>
            <div className="mt-1.5 text-xs text-slate-400 leading-relaxed">
              {networkInfo?.isCloudContainer
                ? 'Running inside an HTTP/HTTPS cloud container — internal TCP 25565 is active for panel probes; deploy to AWS EC2/Lightsail (open TCP 25565 to your IP) for external Minecraft launcher connections.'
                : `Your IP: ${networkInfo?.clientIp ?? '127.0.0.1'} · TCP ${metrics?.port ?? 25565} listening on 0.0.0.0 · ${
                    config?.security?.ipWhitelistEnabled && config?.security?.enforceMinecraftIpWhitelist
                      ? `IP Whitelist Active (${config.security.allowedIps.length} rules)`
                      : 'Open TCP Access'
                  }`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:flex items-center gap-2 shrink-0">
          <button
            onClick={() => triggerAction('start')}
            disabled={isRunning || busyAction !== null}
            className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            Start
          </button>
          <button
            onClick={() => triggerAction('restart')}
            disabled={busyAction !== null}
            className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Restart
          </button>
          <button
            onClick={() => triggerAction('stop')}
            disabled={!isRunning || busyAction !== null}
            className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-md text-xs font-medium bg-rose-950/60 hover:bg-rose-900/70 disabled:opacity-40 disabled:pointer-events-none text-rose-200 border border-rose-800/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" />
            Stop
          </button>
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Tick Rate (TPS)</span>
            <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className={`mt-2 text-xl sm:text-2xl font-display font-semibold font-mono tabular-nums ${tpsColor}`}>
            {isRunning ? (metrics?.tps ?? 20).toFixed(2) : '0.00'}
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 font-mono tabular-nums truncate">
            {metrics?.mspt?.toFixed(2) ?? '0.00'} ms/tick
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Memory Usage</span>
            <HardDrive className="w-4 h-4 text-sky-400 shrink-0" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {metrics?.ramUsedMb ?? 0} <span className="text-xs sm:text-sm font-normal text-slate-400">MB</span>
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 font-mono tabular-nums truncate">
            {metrics?.ramTotalMb ?? 0} MB host
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>CPU Load</span>
            <Cpu className="w-4 h-4 text-amber-400 shrink-0" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {(metrics?.cpuPercent ?? 0).toFixed(1)}
            <span className="text-xs sm:text-sm font-normal text-slate-400">%</span>
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 font-mono tabular-nums truncate">
            Worker {metrics?.workerActive ? 'isolated' : 'idle'}
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Players</span>
            <Users className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {metrics?.onlinePlayers ?? 0}{' '}
            <span className="text-xs sm:text-sm font-normal text-slate-500">/ {metrics?.maxPlayers ?? 50}</span>
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 tabular-nums capitalize truncate">
            {config?.gamemode ?? 'survival'} · {config?.worldType ?? 'superflat'}
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 bg-[#111620] border border-slate-800/80 rounded-lg p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Uptime</span>
            <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {formatUptime(metrics?.uptimeMs ?? 0)}
          </div>
          <div className="mt-1 text-[11px] sm:text-xs text-slate-500 font-mono tabular-nums">
            Ticks: {(metrics?.tickCount ?? 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Live SVG Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TelemetrySvgChart
          data={history}
          accessor={(s) => s.tps}
          maxValue={20}
          stroke="#10b981"
          fill="rgba(16, 185, 129, 0.12)"
          unit="TPS"
          label="Tick Rate & Frame Budget"
          currentText={isRunning ? (metrics?.tps ?? 20).toFixed(2) : '0.00'}
          secondaryLabel="MSPT"
          secondaryAccessor={(s) => s.mspt}
          secondaryMax={50}
          secondaryStroke="#38bdf8"
          secondaryCurrentText={`${(metrics?.mspt ?? 0).toFixed(2)} ms`}
        />

        <TelemetrySvgChart
          data={history}
          accessor={(s) => s.ramMb}
          maxValue={Math.max(256, (metrics?.ramUsedMb ?? 128) * 1.6)}
          stroke="#38bdf8"
          fill="rgba(56, 189, 248, 0.12)"
          unit="MB"
          label="Memory & CPU Load"
          currentText={String(metrics?.ramUsedMb ?? 0)}
          secondaryLabel="CPU"
          secondaryAccessor={(s) => s.cpuPercent}
          secondaryMax={100}
          secondaryStroke="#f59e0b"
          secondaryCurrentText={`${(metrics?.cpuPercent ?? 0).toFixed(1)}%`}
        />
      </div>

      {/* Engine Telemetry & Protocol 1.21-26.3 Live Probe */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Engine & Shield Telemetry</h3>
              <p className="text-xs text-slate-400 mt-1">
                Core {metrics?.minecraftVersion ?? '26.3'} (Proto {metrics?.protocolVersion ?? 777}) · ViaBackwards {metrics?.supportedVersions ?? '1.21 – 26.3'} ·{' '}
                {metrics?.runtime === 'bun' ? `Bun v${metrics.runtimeVersion}` : `Node ${metrics?.runtimeVersion}`}
              </p>
            </div>
            <div className="sm:text-right font-mono text-xs tabular-nums shrink-0">
              <div className="text-slate-200">0.0.0.0:{metrics?.port ?? 25565}</div>
              <div className="text-slate-500 mt-0.5">
                Zlib threshold {config?.compressionThreshold ?? 256}B
              </div>
            </div>
          </div>

          <div className="mt-4 sm:mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-xs">
            <div>
              <div className="text-slate-500">Packets In</div>
              <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                {(metrics?.totalPacketsIn ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Packets Out</div>
              <div className="mt-1 text-base font-mono font-semibold text-slate-100 tabular-nums">
                {(metrics?.totalPacketsOut ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Shield Drops</div>
              <div className="mt-1 text-base font-mono font-semibold text-amber-400 tabular-nums">
                {(metrics?.droppedPackets ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Blocked IPs</div>
              <div className="mt-1 text-base font-mono font-semibold text-rose-400 tabular-nums">
                {(metrics?.blockedConnections ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4 sm:p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">TCP Protocol & ViaBackwards Live Probe</h3>
            <p className="text-xs text-slate-400 mt-1">
              Test genuine TCP connections to 127.0.0.1:{metrics?.port ?? 25565} across 1.21–26.3 and verify the Crash-Proof Shield.
            </p>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5">
            <select
              value={probeProtocol}
              onChange={(e) => setProbeProtocol(Number(e.target.value))}
              className="px-2.5 py-2 text-xs font-mono bg-[#0b0e14] border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value={777}>26.3 (Proto 777 Native)</option>
              <option value={775}>26.1 (Proto 775 Via)</option>
              <option value={774}>1.21.11 (Proto 774 Via)</option>
              <option value={770}>1.21.5 (Proto 770 Via)</option>
              <option value={769}>1.21.4 (Proto 769 Via)</option>
              <option value={767}>1.21 (Proto 767 Via)</option>
            </select>
            <button
              onClick={spawnProbePlayer}
              disabled={!isRunning || busyAction !== null}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Connect Test Player
            </button>
            <div className="grid grid-cols-2 sm:flex gap-2">
              <button
                onClick={runStatusPing}
                disabled={!isRunning || busyAction !== null}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                Status Ping
              </button>
              <button
                onClick={testMalformedShield}
                disabled={!isRunning || busyAction !== null}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                Shield Test
              </button>
            </div>
          </div>

          {probeStatusResult ? (
            <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs space-y-1 font-mono">
              <div className="flex items-center justify-between gap-2 text-slate-300">
                <span className="truncate">MOTD: {probeStatusResult.motd}</span>
                <span className="text-emerald-400 tabular-nums shrink-0">{probeStatusResult.rttMs} ms</span>
              </div>
              <div className="text-slate-500 tabular-nums">
                Version {probeStatusResult.versionName} · Protocol {probeStatusResult.protocol} · Players{' '}
                {probeStatusResult.onlinePlayers}/{probeStatusResult.maxPlayers}
              </div>
            </div>
          ) : (
            <div className="mt-4 pt-3 border-t border-slate-800/80 text-xs text-slate-500">
              MOTD: {config?.motd ?? 'AetherCore 26.3'} · View Distance {config?.viewDistance ?? 6} chunks
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
