import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

export const CREDENTIALS_FILE_VERSION = 1;

export interface StoredCredentials {
  version: number;
  accessToken: string;
  campId: string;
  updatedAt: string;
}

export function defaultCredentialsPath(): string {
  const fromEnv = (process.env.LOCALSBNB_CREDENTIALS_PATH || '').trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), '.localsbnb', 'credentials.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function parseStoredCredentials(raw: unknown): StoredCredentials | null {
  if (!isRecord(raw)) return null;
  const accessToken = String(raw.accessToken ?? '').trim();
  const campId = String(raw.campId ?? '').trim();
  if (!accessToken || !campId) return null;
  const version = Number(raw.version ?? CREDENTIALS_FILE_VERSION);
  const updatedAt = String(raw.updatedAt ?? '').trim() || new Date().toISOString();
  return {
    version: Number.isFinite(version) ? version : CREDENTIALS_FILE_VERSION,
    accessToken,
    campId,
    updatedAt,
  };
}

export function readStoredCredentials(filePath = defaultCredentialsPath()): StoredCredentials | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parseStoredCredentials(JSON.parse(raw) as unknown);
    if (!parsed) {
      logger.warn('Ignored incomplete LocalsBnb credentials file');
      return null;
    }
    logger.info('Loaded LocalsBnb credentials from file');
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Failed to read LocalsBnb credentials file', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

export function writeStoredCredentials(
  credentials: Omit<StoredCredentials, 'version' | 'updatedAt'> & { updatedAt?: string },
  filePath = defaultCredentialsPath()
): StoredCredentials {
  const stored: StoredCredentials = {
    version: CREDENTIALS_FILE_VERSION,
    accessToken: credentials.accessToken.trim(),
    campId: credentials.campId.trim(),
    updatedAt: credentials.updatedAt || new Date().toISOString(),
  };
  if (!stored.accessToken || !stored.campId) {
    throw new Error('Cannot persist LocalsBnb credentials without accessToken and campId');
  }

  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Windows and some FS ignore chmod
  }

  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmpPath, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Windows and some FS ignore chmod
  }
  logger.info('Saved LocalsBnb credentials to file');
  return stored;
}
