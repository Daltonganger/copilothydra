/**
 * CopilotHydra — TUI menu (stub)
 *
 * Phase 0 scaffold for the account management TUI.
 * Full implementation is Phase 5.
 *
 * The TUI is the only account management interface in v1 (TUI-only per PLAN.md).
 *
 * Requirements (from PLAN.md Phase 5):
 * - add/remove/rename/revalidate accounts
 * - show plan tier, capabilityState, lifecycleState
 * - show restart-required state
 * - non-TTY clean failure
 * - always restore terminal state (raw-mode safety)
 * - no internal provider IDs as primary user-facing identity
 *
 * Spike E findings:
 * - OpenCode's own interactive flows use @clack/prompts-style terminal UX
 * - OAuth device flows are browser-assisted + polling-based
 * - A CopilotHydra TUI does not need embedded browser handling; it only needs
 *   to present URL/code clearly and survive non-TTY environments cleanly
 */

import { warn } from "../log.js";

// ---------------------------------------------------------------------------
// Non-TTY guard
// ---------------------------------------------------------------------------

/**
 * Returns true if the current terminal supports raw mode (interactive TUI).
 */
export function isTTY(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

// ---------------------------------------------------------------------------
// Stub entrypoint
// ---------------------------------------------------------------------------

/**
 * Launch the account management TUI.
 *
 * TODO (Phase 5): implement full TUI with ink or a minimal readline loop.
 */
export async function launchMenu(): Promise<void> {
  if (!isTTY()) {
    warn(
      "ui",
      "CopilotHydra account management requires an interactive terminal (TTY). " +
      "Non-TTY environments are not supported in v1."
    );
    process.exit(1);
  }

  // Stub: real TUI is Phase 5
  console.error(
    "[copilothydra] TUI not yet implemented. This is a Phase 0 scaffold.\n" +
    "Account management will be available in Phase 5."
  );
}
