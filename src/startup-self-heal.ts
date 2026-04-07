/**
 * CopilotHydra — startup auth-drift self-heal
 *
 * On every plugin startup/reload, CopilotHydra reconciles provider config and
 * auth.json entries for all active accounts. This prevents "Bad Request" errors
 * caused by auth drift (e.g. auth.json missing an oauth entry for a providerId
 * after a manual edit, OS migration, or partial cleanup).
 *
 * The function is idempotent and safe to call repeatedly — it only writes
 * entries that are missing.
 */

import { syncAccountsToOpenCodeConfig } from "./config/sync.js";
import { debug, warn } from "./log.js";

/**
 * Reconcile provider config and auth.json entries for all active accounts.
 *
 * Called once at module load time (plugin startup) when active accounts exist.
 * Wraps syncAccountsToOpenCodeConfig() which handles both the provider entries
 * in opencode.json AND the oauth backfill in auth.json.
 *
 * Errors are caught and logged — startup must never crash due to self-heal
 * failure; the user can still re-auth interactively.
 */
export async function selfHealAuthDrift(): Promise<void> {
	try {
		await syncAccountsToOpenCodeConfig();
		debug("plugin", "Startup self-heal: auth drift check completed");
	} catch (err_) {
		// Warn but never crash startup — the user can still re-auth interactively.
		warn("plugin", `Startup self-heal failed: ${String(err_)}`);
	}
}
