import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BannedPlayer,
  ConsoleLog,
  MetricSample,
  NetworkInfo,
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
  authRequired: boolean;
  clientIp: string;
  metrics: ServerMetrics | null;
  history: MetricSample[];
  logs: ConsoleLog[];
  players: PlayerInfo[];
  bans: BannedPlayer[];
  packets: PacketLogEntry[];
  plugins: PluginMetadata[];
  config: ServerConfig | null;
  networkInfo: NetworkInfo | null;
  toasts: ToastMessage[];
}

const TOKEN_STORAGE_KEY = 'aethercore_panel_token';

export function getStoredPanelToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredPanelToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getStoredPanelToken();
  const headers = new Headers(init?.headers || {});
  if (token) {
    headers.set('x-panel-token', token);
  }
  return fetch(input, { ...init, headers });
}

export function useServerSocket() {
  const [state, setState] = useState<ServerPanelState>({
    connected: false,
    loading: true,
    authRequired: false,
    clientIp: '127.0.0.1',
    metrics: null,
    history: [],
    logs: [],
    players: [],
    bans: [],
    packets: [],
    plugins: [],
    config: null,
    networkInfo: null,
    toasts: [],
  });

  const [authNonce, setAuthNonce] = useState(0);
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

  const refreshNetworkInfo = useCallback(async () => {
    try {
      const res = await apiFetch('/api/network-info');
      if (res.ok) {
        const netData = (await res.json()) as NetworkInfo;
        setState((prev) => ({ ...prev, networkInfo: netData }));
      }
    } catch {
      // Ignore
    }
  }, []);

  const unlockWithToken = useCallback(async (token: string): Promise<boolean> => {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return false;
    setStoredPanelToken(token);
    setState((prev) => ({ ...prev, authRequired: false, loading: true }));
    setAuthNonce((n) => n + 1);
    return true;
  }, []);

  useEffect(() => {
    let unmounted = false;

    const initConnection = async () => {
      try {
        const authRes = await apiFetch('/api/auth/status');
        const authData = (await authRes.json()) as {
          protected: boolean;
          authorized: boolean;
          clientIp: string;
        };

        if (unmounted) return;
        if (authData.protected && !authData.authorized) {
          setState((prev) => ({
            ...prev,
            loading: false,
            authRequired: true,
            clientIp: authData.clientIp,
          }));
          return;
        }

        const [stateRes, netRes] = await Promise.all([
          apiFetch('/api/state'),
          apiFetch('/api/network-info'),
        ]);

        if (unmounted) return;
        if (stateRes.status === 401) {
          setState((prev) => ({ ...prev, loading: false, authRequired: true }));
          return;
        }

        const data = await stateRes.json();
        const netData = netRes.ok ? ((await netRes.json()) as NetworkInfo) : null;

        setState((prev) => ({
          ...prev,
          loading: false,
          authRequired: false,
          clientIp: authData.clientIp,
          metrics: data.metrics,
          history: data.history ?? [],
          logs: data.logs ?? [],
          players: data.players ?? [],
          bans: data.bans ?? [],
          packets: data.packets ?? [],
          plugins: data.plugins ?? [],
          config: data.config ?? null,
          networkInfo: netData,
        }));
      } catch {
        if (!unmounted) setState((prev) => ({ ...prev, loading: false }));
      }
    };

    void initConnection();

    const connectWs = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getStoredPanelToken();
      const wsUrl = token
        ? `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
        : `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
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
              void refreshNetworkInfo();
              break;
            case 'toast':
              pushToast(msg.payload.level, msg.payload.title, msg.payload.message);
              break;
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = (evt) => {
        if (unmounted) return;
        setState((prev) => ({ ...prev, connected: false }));
        if (evt.code === 1008) return; // Auth rejected
        reconnectTimerRef.current = setTimeout(connectWs, 1500);
      };
    };

    connectWs();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [pushToast, refreshNetworkInfo, authNonce]);

  return {
    ...state,
    pushToast,
    dismissToast,
    setPacketsPaused,
    clearPacketsLocal,
    clearLogsLocal,
    unlockWithToken,
    refreshNetworkInfo,
  };
}
