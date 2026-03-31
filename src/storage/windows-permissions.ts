/**
 * CopilotHydra — Windows file permission hardening
 *
 * Uses icacls (built-in Windows tool) to restrict secrets/account files
 * to the current user only. This is a best-effort operation — failures
 * are logged but never thrown.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warn } from "../log.js";

const execFileAsync = promisify(execFile);

/**
 * Harden file permissions on Windows using icacls.
 *
 * Removes inherited permissions and grants full control to the current user only.
 * Returns `true` on success, `false` on failure or if not on Windows.
 *
 * This function never throws — all errors are caught and logged.
 */
export async function hardenWindowsFilePermissions(path: string): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const username = process.env.USERNAME ?? process.env.USER ?? "";
    if (!username) {
      warn("storage", "Cannot harden Windows file permissions: unable to determine current username");
      return false;
    }

    await execFileAsync("icacls", [path, "/inheritance:r", "/grant:r", `${username}:F`]);
    return true;
  } catch (err) {
    warn("storage", `Failed to harden Windows file permissions via icacls: ${String(err)}`);
    return false;
  }
}
