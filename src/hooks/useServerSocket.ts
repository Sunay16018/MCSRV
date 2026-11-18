import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BannedPlayer,
  ConsoleLog,
  MetricSample,
  PacketLogEntry,
  PlayerInfo,
  PluginMetadata,
  ServerConfig,
  ServerMetrics,
  WsServerEvent,
} from '../shared/types.ts';

export interface ToastMessage {
  id: string;
  level: 'success' | 'warn' | 'error';
  title: string;
  message: string;
}

export interface ServerPanelState {
  connected: boolean;
  loading: boolean;
  metrics: ServerMetrics | null;
  history: MetricSample[];
  logs: ConsoleLog[];
  players: PlayerInfo[];
  bans: BannedPlayer[];
  packets: PacketLogEntry[];
  plugins: PluginMetadata[];
  config: ServerConfig | null;
  toasts: ToastMessage[];
}

export function useServerSocket() {
  const [state, setState] = useState<ServerPanelState>({
    connected: false,
    loading: true,
    metrics: null,
    history: [],
    logs: [],
    players: [],
    bans: [],
    packets: [],
    plugins: [],
    config: null,
    toasts: [],
  });

  const packetPausedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((level: ToastMessage['level'], title: string, message: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setState((prev) => ({
      ...prev,
      toasts: [...prev.toasts.slice(-3), { id, level, title, message }],
    }));
    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        toasts: prev.toasts.filter((t) => t.id !== id),
      }));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      toasts: prev.toasts.filter((t) => t.id !== id),
    }));
  }, []);

  const setPacketsPaused = useCallback((paused: boolean) => {
    packetPausedRef.current = paused;
  }, []);

  const clearPacketsLocal = useCallback(() => {
    setState((prev) => ({ ...prev, packets: [] }));
  }, []);

  const clearLogsLocal = useCallback(() => {
    setState((prev) => ({ ...prev, logs: [] }));
  }, []);

  useEffect(() => {
    let unmounted = false;

    // Initial HTTP hydration for instant first paint
    fetch('/api/state')
      .then((r) => r.json())
      .then((data) => {
        if (unmounted) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          metrics: data.metrics,
          history: data.history ?? [],
          logs: data.logs ?? [],
          players: data.players ?? [],
          bans: data.bans ?? [],
          packets: data.packets ?? [],
          plugins: data.plugins ?? [],
          config: data.config ?? null,
        }));
      })
      .catch(() => {
        if (!unmounted) setState((prev) => ({ ...prev, loading: false }));
      });

    const connectWs = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        setState((prev) => ({ ...prev, connected: true }));
      };

      ws.onmessage = (evt) => {
        if (unmounted) return;
        try {
          const msg = JSON.parse(evt.data) as WsServerEvent;
          switch (msg.type) {
            case 'init':
              setState((prev) => ({
                ...prev,
                loading: false,
                metrics: msg.payload.metrics,
                history: msg.payload.history,
                logs: msg.payload.logs,
                players: msg.payload.players,
                bans: msg.payload.bans,
                packets: msg.payload.packets,
                plugins: msg.payload.plugins,
                config: msg.payload.config,
              }));
              break;
            case 'metrics':
              setState((prev) => ({
                ...prev,
                metrics: msg.payload.metrics,
                history: [...prev.history.slice(-89), msg.payload.sample],
              }));
              break;
            case 'log':
              setState((prev) => ({
                ...prev,
                logs: [...prev.logs.slice(-399), msg.payload],
              }));
              break;
            case 'packet':
              if (!packetPausedRef.current) {
                setState((prev) => ({
                  ...prev,
                  packets: [...prev.packets.slice(-299), msg.payload],
                }));
              }
              break;
            case 'players':
              setState((prev) => ({ ...prev, players: msg.payload }));
              break;
            case 'bans':
              setState((prev) => ({ ...prev, bans: msg.payload }));
              break;
            case 'plugins':
              setState((prev) => ({ ...prev, plugins: msg.payload }));
              break;
            case 'config':
              setState((prev) => ({ ...prev, config: msg.payload }));
              break;
            case 'toast':
              pushToast(msg.payload.level, msg.payload.title, msg.payload.message);
              break;
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setState((prev) => ({ ...prev, connected: false }));
        reconnectTimerRef.current = setTimeout(connectWs, 1500);
      };
    };

    connectWs();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [pushToast]);

  return {
    ...state,
    pushToast,
    dismissToast,
    setPacketsPaused,
    clearPacketsLocal,
    clearLogsLocal,
  };
}
