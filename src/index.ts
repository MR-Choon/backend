import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { Rcon } from 'rcon-client';
import type { LogEntry, Player, ServerStatus, ServerStats, SnapshotPayload } from './types.js';

const exec = promisify(execCallback);

const PORT = Number(process.env.PORT ?? 8080);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000);

const MC_HOST = process.env.MC_HOST ?? '127.0.0.1';
const MC_RCON_PORT = Number(process.env.MC_RCON_PORT ?? 25575);
const MC_RCON_PASSWORD = process.env.MC_RCON_PASSWORD ?? '';
const MC_START_COMMAND = process.env.MC_START_COMMAND ?? '';
const MC_STOP_COMMAND = process.env.MC_STOP_COMMAND ?? '';

const isRconEnabled = MC_RCON_PASSWORD.trim().length > 0;

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

const nowTime = (): string => new Date().toLocaleTimeString('ko-KR', { hour12: false });
const nowIso = (): string => new Date().toISOString();

const initialPlayers: Player[] = [
  {
    id: '1',
    name: 'Steve_Craft',
    uuid: '550e8400-e29b-41d4-a716-446655440000',
    rank: 'Admin',
    joinedAt: '2023-10-12',
    location: 'Spawn',
    isOnline: true,
    avatarUrl: 'https://picsum.photos/seed/steve/64/64',
  },
  {
    id: '2',
    name: 'Alex_Architect',
    uuid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    rank: 'Moderator',
    joinedAt: '2023-11-05',
    location: 'Creative Zone',
    isOnline: true,
    avatarUrl: 'https://picsum.photos/seed/alex/64/64',
  },
  {
    id: '3',
    name: 'Miner_Joe',
    uuid: '8da7b810-9dad-11d1-80b4-00c04fd430c8',
    rank: 'Player',
    joinedAt: '2024-01-20',
    location: 'Deep Caves',
    isOnline: false,
    avatarUrl: 'https://picsum.photos/seed/joe/64/64',
  },
];

const initialStats: ServerStats = {
  cpuUsage: 12,
  ramUsage: 4.2,
  ramTotal: 8,
  diskUsage: 24,
  diskTotal: 128,
  onlinePlayers: initialPlayers.filter((p) => p.isOnline).length,
  maxPlayers: 100,
  uptime: '0d 00h 00m',
  tps: 19.95,
};

let status: ServerStatus = 'online';
let startedAt = Date.now();
let logs: LogEntry[] = [
  { timestamp: nowTime(), level: 'INFO', message: 'Backend booted.' },
  { timestamp: nowTime(), level: 'INFO', message: 'Dashboard bridge is ready.' },
];
let players: Player[] = initialPlayers;
let stats: ServerStats = initialStats;

const snapshot = (): SnapshotPayload => ({
  status,
  stats,
  players,
  logs,
  updatedAt: nowIso(),
});

const emitSnapshot = (): void => {
  io.emit('snapshot', snapshot());
};

const pushLog = (level: LogEntry['level'], message: string): void => {
  logs = [...logs, { timestamp: nowTime(), level, message }].slice(-300);
  io.emit('log:new', logs[logs.length - 1]);
};

const setStatus = (next: ServerStatus): void => {
  status = next;
  emitSnapshot();
};

const formatUptime = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
};

const rand = (min: number, max: number): number => Math.random() * (max - min) + min;

const runShellCommandIfProvided = async (command: string): Promise<void> => {
  if (!command.trim()) {
    return;
  }

  await exec(command, { windowsHide: true });
};

const parseOnlinePlayersFromList = (response: string): number | null => {
  // Vanilla list example: "There are 2 of a max of 20 players online: a, b"
  const match = response.match(/There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online/i);
  if (!match) {
    return null;
  }

  const online = Number(match[1]);
  const max = Number(match[2]);
  if (Number.isFinite(online) && Number.isFinite(max)) {
    stats = { ...stats, onlinePlayers: online, maxPlayers: max };
    return online;
  }

  return null;
};

const executeRconCommand = async (command: string): Promise<string> => {
  const rcon = await Rcon.connect({
    host: MC_HOST,
    port: MC_RCON_PORT,
    password: MC_RCON_PASSWORD,
    timeout: 5000,
  });

  try {
    const response = await rcon.send(command);
    parseOnlinePlayersFromList(response);
    return response || '(empty response)';
  } finally {
    await rcon.end();
  }
};

const executeMockCommand = async (command: string): Promise<string> => {
  if (command === 'list') {
    const online = players.filter((p) => p.isOnline).map((p) => p.name);
    return `There are ${online.length} of a max of ${stats.maxPlayers} players online: ${online.join(', ')}`;
  }

  if (command === 'tps') {
    return `TPS from last 1m, 5m, 15m: ${stats.tps.toFixed(2)}, ${stats.tps.toFixed(2)}, ${stats.tps.toFixed(2)}`;
  }

  if (command.startsWith('say ')) {
    return '[Server] message broadcasted';
  }

  return `Mock executed: ${command}`;
};

const executeServerCommand = async (command: string): Promise<string> => {
  pushLog('INFO', `> ${command}`);

  try {
    const response = isRconEnabled
      ? await executeRconCommand(command)
      : await executeMockCommand(command);

    pushLog('INFO', response);
    emitSnapshot();
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown command error';
    pushLog('ERROR', message);
    emitSnapshot();
    throw new Error(message);
  }
};

const startServer = async (): Promise<void> => {
  if (status === 'online' || status === 'starting') {
    return;
  }

  setStatus('starting');
  pushLog('INFO', 'Starting server...');

  try {
    await runShellCommandIfProvided(MC_START_COMMAND);
  } catch (error) {
    pushLog('WARN', `Start command failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  startedAt = Date.now();
  setTimeout(() => {
    setStatus('online');
    pushLog('INFO', 'Server is online.');
    emitSnapshot();
  }, 1200);
};

const stopServer = async (): Promise<void> => {
  if (status === 'offline' || status === 'stopping') {
    return;
  }

  setStatus('stopping');
  pushLog('WARN', 'Stopping server...');

  try {
    if (MC_STOP_COMMAND.trim()) {
      await runShellCommandIfProvided(MC_STOP_COMMAND);
    } else {
      await executeServerCommand('stop');
    }
  } catch (error) {
    pushLog('WARN', `Stop command failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  setTimeout(() => {
    setStatus('offline');
    pushLog('WARN', 'Server is offline.');
    emitSnapshot();
  }, 900);
};

const pollTick = (): void => {
  const uptime = formatUptime(Date.now() - startedAt);

  if (status === 'online') {
    const onlinePlayers = players.filter((p) => p.isOnline).length;
    stats = {
      ...stats,
      cpuUsage: Number(rand(8, 42).toFixed(1)),
      ramUsage: Number(rand(3.9, 6.5).toFixed(2)),
      diskUsage: Number(rand(24, 27).toFixed(1)),
      tps: Number(rand(19.5, 20).toFixed(2)),
      onlinePlayers,
      uptime,
    };
  } else {
    stats = {
      ...stats,
      cpuUsage: 0,
      tps: 0,
      uptime,
      onlinePlayers: 0,
    };
  }

  emitSnapshot();
};

io.on('connection', (socket) => {
  socket.emit('snapshot', snapshot());
  pushLog('INFO', `Dashboard connected: ${socket.id}`);

  socket.on('command:send', async (payload: { command?: string }) => {
    const command = payload?.command?.trim();
    if (!command) {
      return;
    }

    try {
      const response = await executeServerCommand(command);
      socket.emit('command:result', { ok: true, command, response });
    } catch (error) {
      socket.emit('command:result', {
        ok: false,
        command,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  socket.on('disconnect', () => {
    pushLog('INFO', `Dashboard disconnected: ${socket.id}`);
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status, rcon: isRconEnabled ? 'enabled' : 'mock' });
});

app.get('/api/snapshot', (_req, res) => {
  res.json(snapshot());
});

app.post('/api/command', async (req, res) => {
  const command = String(req.body?.command ?? '').trim();
  if (!command) {
    return res.status(400).json({ ok: false, error: 'command is required' });
  }

  try {
    const response = await executeServerCommand(command);
    return res.json({ ok: true, response });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/api/server/start', async (_req, res) => {
  await startServer();
  res.json({ ok: true, status });
});

app.post('/api/server/stop', async (_req, res) => {
  await stopServer();
  res.json({ ok: true, status });
});

setInterval(pollTick, POLL_INTERVAL_MS);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`MC dashboard backend listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Mode: ${isRconEnabled ? 'RCON' : 'MOCK'}`);
});
