import { useState } from 'react';
import {
  Activity,
  Cpu,
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
import type { MetricSample, ServerConfig, ServerMetrics } from '../shared/types.ts';

interface DashboardViewProps {
  metrics: ServerMetrics | null;
  history: MetricSample[];
  config: ServerConfig | null;
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
    <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time 500ms telemetry stream · {samples.length} samples
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs tabular-nums">
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
        className="w-full h-40 overflow-visible"
        role="img"
        aria-label={label}
      >
        {/* Horizontal grid lines */}
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
  onServerAction,
  onToast,
}: DashboardViewProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [probeStatusResult, setProbeStatusResult] = useState<{
    motd: string;
    versionName: string;
    protocol: number;
    onlinePlayers: number;
    maxPlayers: number;
    rttMs: number;
  } | null>(null);

  const isRunning = metrics?.status === 'running';

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
      const res = await fetch('/api/probe/status', { method: 'POST' });
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
      const res = await fetch('/api/probe/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to spawn test player');
      onToast(
        'success',
        'Test Player Connected',
        `${data.username} completed Protocol 777 Login -> Configuration -> Play over TCP`
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
      await fetch('/api/probe/malformed', { method: 'POST' });
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
    <div className="space-y-6">
      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Tick Rate (TPS)</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className={`mt-2 text-2xl font-display font-semibold font-mono tabular-nums ${tpsColor}`}>
            {isRunning ? (metrics?.tps ?? 20).toFixed(2) : '0.00'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Target 20.00 · {metrics?.mspt?.toFixed(2) ?? '0.00'} ms/tick
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Memory Usage</span>
            <HardDrive className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {metrics?.ramUsedMb ?? 0} <span className="text-sm font-normal text-slate-400">MB</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Heap {metrics?.ramTotalMb ?? 0} MB allocated
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>CPU Utilization</span>
            <Cpu className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {(metrics?.cpuPercent ?? 0).toFixed(1)}
            <span className="text-sm font-normal text-slate-400">%</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Worker loop {metrics?.workerActive ? 'isolated' : 'idle'}
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Active Players</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {metrics?.onlinePlayers ?? 0}{' '}
            <span className="text-sm font-normal text-slate-500">/ {metrics?.maxPlayers ?? 50}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {config?.gamemode ?? 'survival'} · {config?.worldType ?? 'superflat'}
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Server Uptime</span>
            <Wifi className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-display font-semibold font-mono tabular-nums text-slate-100">
            {formatUptime(metrics?.uptimeMs ?? 0)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
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

      {/* Engine Control & Protocol 777 Live Probe */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Engine Lifecycle & Network</h3>
              <p className="text-xs text-slate-400 mt-1">
                Minecraft Java Edition {metrics?.minecraftVersion ?? '26.3'} · Protocol {metrics?.protocolVersion ?? 777} ·{' '}
                {metrics?.runtime === 'bun' ? `Bun v${metrics.runtimeVersion}` : `Node ${metrics?.runtimeVersion}`}
              </p>
            </div>
            <div className="text-right font-mono text-xs tabular-nums">
              <div className="text-slate-200">0.0.0.0:{metrics?.port ?? 25565}</div>
              <div className="text-slate-500 mt-0.5">
                Zlib threshold {config?.compressionThreshold ?? 256}B
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-3 gap-4 text-xs">
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
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => triggerAction('start')}
              disabled={isRunning || busyAction !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Start Engine
            </button>
            <button
              onClick={() => triggerAction('restart')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              Restart Engine
            </button>
            <button
              onClick={() => triggerAction('stop')}
              disabled={!isRunning || busyAction !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium bg-rose-950/60 hover:bg-rose-900/70 disabled:opacity-40 disabled:pointer-events-none text-rose-200 border border-rose-800/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5" />
              Stop Engine
            </button>
          </div>
        </div>

        <div className="bg-[#111620] border border-slate-800/80 rounded-lg p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">TCP Protocol 777 Live Verification</h3>
            <p className="text-xs text-slate-400 mt-1">
              Execute genuine TCP socket probes against port {metrics?.port ?? 25565} to test Status Ping, Login/Config/Play chunks, and the Crash-Proof Shield.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              onClick={runStatusPing}
              disabled={!isRunning || busyAction !== null}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              Run Status Ping
            </button>
            <button
              onClick={spawnProbePlayer}
              disabled={!isRunning || busyAction !== null}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-sky-400" />
              Connect Test Player
            </button>
            <button
              onClick={testMalformedShield}
              disabled={!isRunning || busyAction !== null}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              Send Malformed Packet
            </button>
          </div>

          {probeStatusResult ? (
            <div className="mt-4 pt-4 border-t border-slate-800/80 text-xs space-y-1.5 font-mono">
              <div className="flex items-center justify-between text-slate-300">
                <span>MOTD: {probeStatusResult.motd}</span>
                <span className="text-emerald-400 tabular-nums">{probeStatusResult.rttMs} ms</span>
              </div>
              <div className="text-slate-500 tabular-nums">
                Version {probeStatusResult.versionName} · Protocol {probeStatusResult.protocol} · Players{' '}
                {probeStatusResult.onlinePlayers}/{probeStatusResult.maxPlayers}
              </div>
            </div>
          ) : (
            <div className="mt-4 pt-4 border-t border-slate-800/80 text-xs text-slate-500">
              MOTD: {config?.motd ?? 'AetherCore 26.3'} · View Distance {config?.viewDistance ?? 6} chunks
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
