import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

import type { PoiSnapshot } from '../tools/overseas/channelConnectionSnapshot.js';

export const HANDSHAKE_TTL_MS = 25 * 60 * 1000;

export interface LocalHandshakeTicket {
  ticketId: string;
  type: 'airbnb_oauth';
  campId: string;
  baselineAccountIds: string[];
  baselineFingerprints: string[];
  baselinePois?: PoiSnapshot[];
  sessionScope?: string;
  completedPois?: PoiSnapshot[];
  createdAt: number;
  expiresAt: number;
}

function storePath(): string {
  const fromEnv = (process.env.LOCALSBNB_HANDSHAKE_STORE || '').trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), '.localsbnb', 'handshakes.json');
}

function readMap(): Record<string, LocalHandshakeTicket> {
  const file = storePath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, LocalHandshakeTicket>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, LocalHandshakeTicket>): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function saveLocalHandshakeTicket(ticket: LocalHandshakeTicket): void {
  const map = readMap();
  const now = Date.now();
  for (const [id, item] of Object.entries(map)) {
    if (!item || item.expiresAt < now) delete map[id];
  }
  map[ticket.ticketId] = ticket;
  writeMap(map);
  logger.info('Saved Airbnb handshake ticket');
}

export function readLocalHandshakeTicket(ticketId: string): LocalHandshakeTicket | null {
  const ticket = readMap()[String(ticketId || '').trim()];
  if (!ticket) return null;
  if (ticket.expiresAt < Date.now()) return null;
  return ticket;
}

/** Resolve the most recent flow internally; the user only needs to say "done". */
export function readLatestLocalHandshakeTicket(sessionScope: string): LocalHandshakeTicket | null {
  return Object.values(readMap())
    .filter(ticket => ticket?.sessionScope === sessionScope && ticket.expiresAt > Date.now())
    .sort((a,b) => b.createdAt-a.createdAt)[0] ?? null;
}
