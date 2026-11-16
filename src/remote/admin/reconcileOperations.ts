/** Run inside the target deployment with its existing env. No secrets on the command line.
 * Plan: node dist/remote/admin/reconcileOperations.js --plan review.json evidence.txt
 * Apply: node dist/remote/admin/reconcileOperations.js --apply review.json evidence.txt
 * Each entry must carry a reviewed expectedVersion before --apply. Never auto-retries writes.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { readRuntimeConfig } from '../runtimeConfig.js';
import { CredentialCipher } from '../oauth/credentialCipher.js';
import { WorkStore } from '../business/workStore.js';

async function main() {
  const [mode, manifestPath, evidencePath] = process.argv.slice(2);
  if (!['--plan', '--apply'].includes(mode) || !manifestPath || !evidencePath)
    throw new Error('Arguments required');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const evidenceSha256 = createHash('sha256').update(readFileSync(evidencePath)).digest('hex');
  const config = readRuntimeConfig(process.env);
  if (manifest.environment !== config.environment || manifest.publicOrigin !== config.publicOrigin ||
      manifest.evidenceSha256 !== evidenceSha256 || !Array.isArray(manifest.operations) ||
      !manifest.operations.length || manifest.operations.length > 20 ||
      new Set(manifest.operations.map((x: any) => x.id)).size !== manifest.operations.length)
    throw new Error('Environment or evidence mismatch');
  const db = new pg.Client({ connectionString: config.databaseUrl,
    ...(config.databaseTlsEnabled ? { ssl: { rejectUnauthorized: true } } : {}),
    connectionTimeoutMillis: 5000, query_timeout: 10000 });
  await db.connect();
  try {
    await db.query('BEGIN');
    const store = new WorkStore(db, new CredentialCipher(config.activeKeyId, config.keys));
    const output = [];
    for (const entry of manifest.operations) {
      const work = await store.forReview(entry.id);
      if (!work) throw new Error('Operation unavailable');
      const review = { ...entry, actor: manifest.actor, evidenceSha256,
        expectedVersion: mode === '--plan' ? work.version : entry.expectedVersion };
      if (mode === '--apply' && !Number.isSafeInteger(entry.expectedVersion)) throw new Error('Reviewed version required');
      // Plans exercise the same checks and CAS in a transaction which is always rolled back.
      if (!await store.rejectAfterReview(work, review)) throw new Error('Concurrent state change');
      output.push({ id: work.id, expectedVersion: work.version, previousStatus: work.status,
        decision: 'rejected_reviewed' });
    }
    await db.query(mode === '--apply' ? 'COMMIT' : 'ROLLBACK');
    console.log(JSON.stringify({ mode, persisted: mode === '--apply', operations: output }));
  } catch {
    await db.query('ROLLBACK');
    throw new Error('Review failed; no batch changes committed');
  } finally { await db.end(); }
}
main().catch(() => { console.error('Reconciliation failed. Verify environment, evidence and expected versions. No upstream business request was sent.'); process.exitCode = 1; });
