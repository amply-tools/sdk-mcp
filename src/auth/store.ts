import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveCredsFile } from '../config.js';

export interface AmplyCredentials {
  endpoint: string;
  token: string;
  refreshToken: string;
  /** ISO 8601 timestamp when the token was last refreshed. We don't actually decode the JWT exp — refresh is reactive on 401. */
  refreshedAt: string;
  userId: string;
  organizationId: string;
  email: string;
}

/**
 * Reads the persisted credentials, or null if no file / unreadable.
 * Never throws on "not logged in" — that's a normal first-run state.
 */
export async function readCredentials(): Promise<AmplyCredentials | null> {
  const path = resolveCredsFile();
  try {
    const buf = await readFile(path, 'utf8');
    const parsed = JSON.parse(buf) as Partial<AmplyCredentials>;
    if (!parsed.token || !parsed.refreshToken || !parsed.endpoint) {
      return null;
    }
    return parsed as AmplyCredentials;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    // Corrupt / unreadable creds file — treat as unauthenticated. Caller can re-login.
    return null;
  }
}

/**
 * Writes credentials atomically (`tmp` + `rename`) with mode 0600.
 * Atomic so a crash mid-write never leaves a half-baked file.
 */
export async function writeCredentials(creds: AmplyCredentials): Promise<void> {
  const path = resolveCredsFile();
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.credentials.${randomUUID()}.tmp`);
  const payload = JSON.stringify(creds, null, 2);
  await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
  } catch {
    // Best-effort — some filesystems (e.g. CI) reject chmod.
  }
  await rename(tmp, path);
}

/**
 * Deletes the credentials file. No-op if it doesn't exist.
 */
export async function clearCredentials(): Promise<void> {
  const path = resolveCredsFile();
  try {
    await unlink(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }
}
