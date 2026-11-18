// Dedicated 20 TPS (50ms) precision game tick loop Worker
// Runs off the main TCP socket I/O thread to guarantee zero-jitter tick timing.

const TARGET_TICK_MS = 50;
let running = false;
let tickCount = 0;
let lastTickEnd = performance.now();
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = performance.now();
const tickDurations: number[] = [];
const tickIntervals: number[] = [];
let timerId: ReturnType<typeof setTimeout> | null = null;
let nextExpectedTick = performance.now() + TARGET_TICK_MS;

function stepTick(): void {
  if (!running) return;
  const tickStart = performance.now();
  const interval = tickStart - lastTickEnd + (tickDurations[tickDurations.length - 1] ?? 0);
  lastTickEnd = tickStart;

  tickCount++;

  // Measure actual execution time of tick housekeeping
  const workEnd = performance.now();
  const mspt = Math.max(0.05, workEnd - tickStart);

  tickDurations.push(mspt);
  if (tickDurations.length > 40) tickDurations.shift();

  if (tickCount > 1) {
    tickIntervals.push(Math.max(TARGET_TICK_MS, interval));
    if (tickIntervals.length > 40) tickIntervals.shift();
  }

  const avgMspt = tickDurations.reduce((a, b) => a + b, 0) / tickDurations.length;
  const avgInterval =
    tickIntervals.length > 0
      ? tickIntervals.reduce((a, b) => a + b, 0) / tickIntervals.length
      : TARGET_TICK_MS;
  const tps = Math.min(20, Math.max(0, 1000 / Math.max(TARGET_TICK_MS, avgInterval)));

  // Emit tick pulse on every tick; emit full telemetry every 10 ticks (500ms)
  let telemetry: {
    tps: number;
    mspt: number;
    ramUsedMb: number;
    ramTotalMb: number;
    cpuPercent: number;
    tickCount: number;
  } | null = null;

  if (tickCount % 10 === 0) {
    const now = performance.now();
    const cpuDelta = process.cpuUsage(lastCpuUsage);
    const elapsedUs = Math.max(1000, (now - lastCpuTime) * 1000);
    const cpuPercent = Math.min(100, Math.max(0.1, ((cpuDelta.user + cpuDelta.system) / elapsedUs) * 100));
    lastCpuUsage = process.cpuUsage();
    lastCpuTime = now;

    const mem = process.memoryUsage();
    telemetry = {
      tps: Number(tps.toFixed(2)),
      mspt: Number(avgMspt.toFixed(2)),
      ramUsedMb: Math.round(mem.rss / (1024 * 1024)),
      ramTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
      cpuPercent: Number(cpuPercent.toFixed(1)),
      tickCount,
    };
  }

  postMessage({
    type: 'tick',
    tickCount,
    mspt: Number(avgMspt.toFixed(2)),
    tps: Number(tps.toFixed(2)),
    telemetry,
  });

  // Drift-compensated 50ms scheduler
  nextExpectedTick += TARGET_TICK_MS;
  const delay = Math.max(1, nextExpectedTick - performance.now());
  if (nextExpectedTick < performance.now() - 250) {
    // Re-sync if paused or overloaded
    nextExpectedTick = performance.now() + TARGET_TICK_MS;
  }
  timerId = setTimeout(stepTick, delay);
}

self.onmessage = (event: MessageEvent<{ type: 'start' | 'stop' }>) => {
  if (event.data.type === 'start') {
    if (running) return;
    running = true;
    lastTickEnd = performance.now();
    nextExpectedTick = performance.now() + TARGET_TICK_MS;
    lastCpuUsage = process.cpuUsage();
    lastCpuTime = performance.now();
    stepTick();
  } else if (event.data.type === 'stop') {
    running = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }
};
