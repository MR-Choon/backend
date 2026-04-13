export type ServerStatus = 'online' | 'offline' | 'starting' | 'stopping';

export interface Player {
  id: string;
  name: string;
  uuid: string;
  rank: 'Admin' | 'Moderator' | 'Player';
  joinedAt: string;
  location: string;
  isOnline: boolean;
  avatarUrl: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'CHAT';
  message: string;
}

export interface ServerStats {
  cpuUsage: number;
  ramUsage: number;
  ramTotal: number;
  diskUsage: number;
  diskTotal: number;
  onlinePlayers: number;
  maxPlayers: number;
  uptime: string;
  tps: number;
}

export interface SnapshotPayload {
  status: ServerStatus;
  stats: ServerStats;
  players: Player[];
  logs: LogEntry[];
  updatedAt: string;
}
