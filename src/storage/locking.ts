/**
 * CopilotHydra — file locking
 *
 * Phase 0 scaffold for cross-process file locking.
 *
 * Requirements (from PLAN.md):
 * - lock the entire transaction (read + modify + write)
 * - account add/remove/update under lock
 * - corruption recovery path
 * - Windows-compatible strategy (best-effort)
 *
 * v1 approach: simple lock file with exponential backoff retry.
 * No external dependency in Phase 0. May be replaced with `proper-lockfile`
 * or similar if the simple strategy proves insufficient.
 *
 * Spike E finding:
 * - OpenCode itself only ships in-memory read/write locks for some internal
 *   operations and does not use file-level locks for auth/config JSON writes.
 * - CopilotHydra's file lock approach is therefore stricter than OpenCode's
 *   own write discipline and remains a reasonable v1 choice.
 * - Our account/secrets writes already use temp-file + rename, which is also
 *   stricter than OpenCode's direct writeFile JSON helper.
 */

import { open, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { debugStorage, warn } from "../log.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_INTERVAL_MS = 100;
const LOCK_STALE_MS = 30_000; // consider a lock stale after 30s

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockHandle {
  release: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Acquire lock
// ---------------------------------------------------------------------------

/**
 * Acquire an exclusive lock on a file.
 *
 * Strategy:
 * - create <path>.lock file with O_EXCL (atomic creation)
 * - retry with backoff until timeout
 * - detect and steal stale locks (based on mtime)
 *
 * @param filePath - The file to lock (will create <filePath>.lock)
 */
export async function acquireLock(filePath: string): Promise<LockHandle> {
  const lockPath = filePath + ".lock";
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      // O_EXCL: fail if file exists — atomic on POSIX and Windows (mostly)
      const fd = await open(lockPath, "wx");
      await fd.close();
      debugStorage(`lock acquired: ${lockPath}`);

      return {
        release: async () => {
          try {
            await unlink(lockPath);
            debugStorage(`lock released: ${lockPath}`);
          } catch {
            // If we can't release the lock, log but don't throw
            warn("storage", `Failed to release lock: ${lockPath}`);
          }
        },
      };
    } catch (err) {
      if (isNodeError(err) && err.code === "EEXIST") {
        // Lock exists — check if it's stale
        const stolen = await tryStealStaleLock(lockPath);
        if (stolen) continue;

        // Not stale, wait and retry
        await sleep(LOCK_RETRY_INTERVAL_MS);
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `[copilothydra] Could not acquire lock on "${filePath}" within ${LOCK_TIMEOUT_MS}ms. ` +
    "Another process may be stuck. If this persists, delete the .lock file manually."
  );
}

// ---------------------------------------------------------------------------
// Locked transaction helper
// ---------------------------------------------------------------------------

/**
 * Run a function under an exclusive lock on a file.
 * Always releases the lock, even if the function throws.
 */
export async function withLock<T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const lock = await acquireLock(filePath);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

// ---------------------------------------------------------------------------
// Stale lock detection
// ---------------------------------------------------------------------------

async function tryStealStaleLock(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    const age = Date.now() - info.mtimeMs;
    if (age > LOCK_STALE_MS) {
      warn("storage", `Stealing stale lock (age: ${Math.round(age / 1000)}s): ${lockPath}`);
      await unlink(lockPath);
      return true;
    }
  } catch {
    // Lock may have been released between check and stat — that's fine
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

// Unused import prevention
void join;
