import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { WsServerEvent } from './src/shared/types.ts';
import { MinecraftServerEngine } from './src/server/minecraftServer.ts';
import {
  buildFileTree,
  createSafeEntry,
  deleteSafeEntry,
  PathTraversalError,
  readSafeFile,
  renameSafeEntry,
  writeSafeFile,
} from './src/server/fileManager.ts';
import {
  disconnectBot,
  moveBotStep,
  runRealStatusProbe,
  sendBotChatOrCommand,
  sendMalformedShieldTest,
  spawnRealProtocolBot,
} from './src/server/protocol/testClient.ts';

const WEB_PORT = Number(process.env.PORT) || 3000;

async function bootstrap(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const mcServer = new MinecraftServerEngine();

  const broadcastWs = (event: WsServerEvent) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  // Wire MinecraftServerEngine events directly to WebSocket broadcast
  mcServer.on('metrics', (payload) => broadcastWs({ type: 'metrics', payload }));
  mcServer.on('log', (payload) => broadcastWs({ type: 'log', payload }));
  mcServer.on('packet', (payload) => broadcastWs({ type: 'packet', payload }));
  mcServer.on('players', (payload) => broadcastWs({ type: 'players', payload }));
  mcServer.on('bans', (payload) => broadcastWs({ type: 'bans', payload }));
  mcServer.on('plugins', (payload) => broadcastWs({ type: 'plugins', payload }));
  mcServer.on('config', (payload) => broadcastWs({ type: 'config', payload }));

  wss.on('connection', (ws) => {
    const initPayload: WsServerEvent = {
      type: 'init',
      payload: {
        metrics: mcServer.getMetrics(),
        history: mcServer.getMetricHistory(),
        logs: mcServer.getConsoleLogs(),
        players: mcServer.getPlayers(),
        packets: mcServer.getPacketLogs(),
        plugins: mcServer.getPlugins(),
        config: mcServer.getConfig(),
        bans: mcServer.getBans(),
      },
    };
    ws.send(JSON.stringify(initPayload));
  });

  // --- Server Lifecycle API ---
  app.get('/api/state', (_req, res) => {
    res.json({
      metrics: mcServer.getMetrics(),
      history: mcServer.getMetricHistory(),
      logs: mcServer.getConsoleLogs(),
      players: mcServer.getPlayers(),
      packets: mcServer.getPacketLogs(),
      plugins: mcServer.getPlugins(),
      config: mcServer.getConfig(),
      bans: mcServer.getBans(),
    });
  });

  app.post('/api/server/start', async (_req, res) => {
    await mcServer.start();
    res.json({ ok: true, metrics: mcServer.getMetrics() });
  });

  app.post('/api/server/stop', async (_req, res) => {
    await mcServer.stop();
    res.json({ ok: true, metrics: mcServer.getMetrics() });
  });

  app.post('/api/server/restart', async (_req, res) => {
    await mcServer.restart();
    res.json({ ok: true, metrics: mcServer.getMetrics() });
  });

  // --- Console Command API ---
  app.post('/api/console/command', async (req, res) => {
    const { command } = req.body as { command?: string };
    if (!command || typeof command !== 'string') {
      res.status(400).json({ error: 'Command string required' });
      return;
    }
    mcServer.log('Console', `> ${command}`, 'INFO');
    const output = await mcServer.executeCommand('CONSOLE', command);
    res.json({ ok: true, output });
  });

  // --- File Manager & IDE API (Path Traversal Protected) ---
  app.get('/api/files/tree', (_req, res) => {
    try {
      res.json({ tree: buildFileTree('') });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/files/read', (req, res) => {
    try {
      const filePath = String(req.query.path ?? '');
      const data = readSafeFile(filePath);
      res.json(data);
    } catch (err) {
      const status = err instanceof PathTraversalError ? 403 : 404;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  app.post('/api/files/write', async (req, res) => {
    try {
      const { path: filePath, content } = req.body as { path?: string; content?: string };
      if (typeof filePath !== 'string' || typeof content !== 'string') {
        res.status(400).json({ error: 'Invalid path or content' });
        return;
      }
      const result = writeSafeFile(filePath, content);

      // Automatic Hot-Reload when saving inside plugins/
      let hotReloadedPlugin = null;
      if (result.path.startsWith('plugins/') && (result.path.endsWith('.ts') || result.path.endsWith('.js'))) {
        hotReloadedPlugin = await mcServer.pluginManager.reloadByRelativePath(result.path);
        if (hotReloadedPlugin) {
          broadcastWs({
            type: 'toast',
            payload: {
              level: hotReloadedPlugin.error ? 'error' : 'success',
              title: hotReloadedPlugin.error ? 'Plugin Reload Failed' : 'Hot-Reload Complete',
              message: hotReloadedPlugin.error
                ? `${hotReloadedPlugin.filename}: ${hotReloadedPlugin.error}`
                : `${hotReloadedPlugin.name} v${hotReloadedPlugin.version} reloaded cleanly.`,
            },
          });
        }
      } else if (result.path === 'config.json') {
        await mcServer.updateConfig(JSON.parse(content));
      }

      res.json({ ok: true, ...result, hotReloadedPlugin });
    } catch (err) {
      const status = err instanceof PathTraversalError ? 403 : 400;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  app.post('/api/files/create', async (req, res) => {
    try {
      const { path: targetPath, type } = req.body as { path?: string; type?: 'file' | 'directory' };
      if (!targetPath || (type !== 'file' && type !== 'directory')) {
        res.status(400).json({ error: 'Valid path and type required' });
        return;
      }
      const created = createSafeEntry(targetPath, type);
      if (type === 'file' && created.startsWith('plugins/')) {
        await mcServer.pluginManager.loadAll();
      }
      res.json({ ok: true, path: created, tree: buildFileTree('') });
    } catch (err) {
      const status = err instanceof PathTraversalError ? 403 : 400;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  app.post('/api/files/rename', async (req, res) => {
    try {
      const { oldPath, newPath } = req.body as { oldPath?: string; newPath?: string };
      if (!oldPath || !newPath) {
        res.status(400).json({ error: 'oldPath and newPath required' });
        return;
      }
      const renamed = renameSafeEntry(oldPath, newPath);
      if (oldPath.startsWith('plugins/') || renamed.startsWith('plugins/')) {
        await mcServer.pluginManager.loadAll();
      }
      res.json({ ok: true, path: renamed, tree: buildFileTree('') });
    } catch (err) {
      const status = err instanceof PathTraversalError ? 403 : 400;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  app.post('/api/files/delete', async (req, res) => {
    try {
      const { path: targetPath } = req.body as { path?: string };
      if (!targetPath) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      deleteSafeEntry(targetPath);
      if (targetPath.startsWith('plugins/')) {
        await mcServer.pluginManager.loadAll();
      }
      res.json({ ok: true, tree: buildFileTree('') });
    } catch (err) {
      const status = err instanceof PathTraversalError ? 403 : 400;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // --- Plugins API ---
  app.get('/api/plugins', (_req, res) => {
    res.json({ plugins: mcServer.getPlugins() });
  });

  app.post('/api/plugins/reload-all', async (_req, res) => {
    const plugins = await mcServer.pluginManager.loadAll();
    res.json({ ok: true, plugins });
  });

  app.post('/api/plugins/create', async (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name) {
        res.status(400).json({ error: 'Plugin name required' });
        return;
      }
      const filename = mcServer.pluginManager.createPluginTemplate(name);
      const plugin = await mcServer.pluginManager.loadOrReloadFile(filename);
      res.json({ ok: true, filename, plugin, plugins: mcServer.getPlugins() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/plugins/:id/toggle', async (req, res) => {
    const { enabled } = req.body as { enabled?: boolean };
    const plugin = await mcServer.pluginManager.setPluginEnabled(req.params.id, Boolean(enabled));
    if (!plugin) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    res.json({ ok: true, plugin, plugins: mcServer.getPlugins() });
  });

  app.post('/api/plugins/:id/reload', async (req, res) => {
    const plugin = await mcServer.pluginManager.reloadPlugin(req.params.id);
    if (!plugin) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    res.json({ ok: true, plugin, plugins: mcServer.getPlugins() });
  });

  // --- Players API ---
  app.post('/api/players/:username/kick', (req, res) => {
    const { reason } = req.body as { reason?: string };
    const ok = mcServer.kickPlayer(req.params.username, reason || 'Kicked from Web Panel');
    res.json({ ok });
  });

  app.post('/api/players/:username/ban', (req, res) => {
    const { reason } = req.body as { reason?: string };
    const ban = mcServer.banPlayer(req.params.username, reason || 'Banned from Web Panel');
    res.json({ ok: true, ban });
  });

  app.post('/api/players/unban', (req, res) => {
    const { username } = req.body as { username?: string };
    if (!username) {
      res.status(400).json({ error: 'Username required' });
      return;
    }
    const ok = mcServer.unbanPlayer(username);
    res.json({ ok });
  });

  app.post('/api/players/:username/op', (req, res) => {
    const { op } = req.body as { op?: boolean };
    mcServer.setOp(req.params.username, Boolean(op));
    res.json({ ok: true });
  });

  app.post('/api/players/:username/tp', async (req, res) => {
    const { x, y, z, target } = req.body as { x?: number; y?: number; z?: number; target?: string };
    if (target) {
      await mcServer.executeCommand('CONSOLE', `tp ${req.params.username} ${target}`);
    } else if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number') {
      await mcServer.executeCommand('CONSOLE', `tp ${req.params.username} ${x} ${y} ${z}`);
    }
    res.json({ ok: true });
  });

  // --- Packet Inspector API ---
  app.post('/api/packets/clear', (_req, res) => {
    mcServer.clearPacketLogs();
    res.json({ ok: true });
  });

  // --- Real TCP Protocol 777 Live Probe API ---
  app.post('/api/probe/status', async (_req, res) => {
    try {
      const result = await runRealStatusProbe(mcServer.getConfig().port);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/probe/spawn', async (req, res) => {
    try {
      const { username } = req.body as { username?: string };
      const chosen = (username || `Probe_${Math.floor(100 + Math.random() * 900)}`).slice(0, 16);
      await spawnRealProtocolBot(mcServer.getConfig().port, chosen);
      res.json({ ok: true, username: chosen });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/probe/disconnect', (req, res) => {
    const { username } = req.body as { username?: string };
    const ok = username ? disconnectBot(username) : false;
    res.json({ ok });
  });

  app.post('/api/probe/chat', (req, res) => {
    const { username, message } = req.body as { username?: string; message?: string };
    if (!username || !message) {
      res.status(400).json({ error: 'username and message required' });
      return;
    }
    const ok = sendBotChatOrCommand(username, message);
    res.json({ ok });
  });

  app.post('/api/probe/move', (req, res) => {
    const { username, dx = 1, dy = 0, dz = 1 } = req.body as { username?: string; dx?: number; dy?: number; dz?: number };
    const p = mcServer.getPlayers().find((pl) => pl.username === username);
    if (!p) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    const ok = moveBotStep(username!, dx, dy, dz, p.x, p.y, p.z);
    res.json({ ok });
  });

  app.post('/api/probe/malformed', async (_req, res) => {
    await sendMalformedShieldTest(mcServer.getConfig().port);
    res.json({ ok: true });
  });

  // --- Config / Settings API ---
  app.post('/api/config', async (req, res) => {
    try {
      const updated = await mcServer.updateConfig(req.body);
      res.json({ ok: true, config: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // --- Vite / Static Frontend Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(WEB_PORT, '0.0.0.0', async () => {
    console.log(`[AetherCore] Web Control Panel listening on http://0.0.0.0:${WEB_PORT}`);
    await mcServer.initialize();
  });
}

bootstrap().catch((err) => {
  console.error('[AetherCore] Fatal bootstrap error:', err);
  process.exit(1);
});
