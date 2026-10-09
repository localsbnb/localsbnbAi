import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  parseStoredCredentials,
  readStoredCredentials,
  writeStoredCredentials,
} from '../src/auth/credentialsStore';

describe('credentials store', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'localsbnb-cred-'));
    filePath = path.join(dir, 'credentials.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects incomplete JSON', () => {
    expect(parseStoredCredentials({ accessToken: 'x' })).toBeNull();
    expect(parseStoredCredentials({ campId: '1' })).toBeNull();
    expect(parseStoredCredentials(null)).toBeNull();
  });

  it('writes 0600-style file without throwing and reads it back', () => {
    const stored = writeStoredCredentials(
      { accessToken: 'tok_abc', campId: '2091', updatedAt: '2026-10-05T00:00:00.000Z' },
      filePath
    );
    expect(stored.version).toBe(1);
    expect(stored.campId).toBe('2091');
    const roundTrip = readStoredCredentials(filePath);
    expect(roundTrip?.accessToken).toBe('tok_abc');
    expect(roundTrip?.campId).toBe('2091');
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { accessToken: string };
    expect(raw.accessToken).toBe('tok_abc');
  });

  it('returns null for missing file', () => {
    expect(readStoredCredentials(path.join(dir, 'missing.json'))).toBeNull();
  });

  it('returns null for invalid JSON file', () => {
    writeFileSync(filePath, '{not json', 'utf8');
    expect(readStoredCredentials(filePath)).toBeNull();
  });
});
