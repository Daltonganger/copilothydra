/**
 * CopilotHydra — copilot-cli-compatible Keychain integration
 *
 * Writes GitHub OAuth tokens into the OS credential store using the same
 * format that `copilot-cli` uses, so that native consumers of that format
 * (confirmed: OpenCode Bar on macOS) can discover them.
 *
 * Format:
 *   service  = "copilot-cli"
 *   account  = "https://github.com:<githubUsername>"
 *   password = raw GitHub OAuth token (UTF-8 string)
 *
 * This module is best-effort: if the native keyring library is unavailable
 * (e.g. on a headless Linux server without Secret Service), all operations
 * return structured failure results instead of throwing.
 */

import { warn, info, debug } from "../log.js";

const COPILOT_CLI_SERVICE = "copilot-cli";

// ---------------------------------------------------------------------------
// Structured keychain result types
// ---------------------------------------------------------------------------

export type KeychainResult = { ok: true } | { ok: false; reason: string };

/**
 * Actionable hint appended to keychain failure messages so callers can
 * surface remediation guidance without hard-coding platform specifics.
 */
export function keychainActionHint(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes("not available") || lower.includes("could not find")) {
    return "Install the native keyring library or run on a system with an OS credential store (macOS Keychain / Linux Secret Service).";
  }
  if (lower.includes("permission") || lower.includes("access") || lower.includes("denied")) {
    return "Check OS keychain/keyring permissions for the calling process.";
  }
  if (lower.includes("user cancelled") || lower.includes("user dismissed")) {
    return "The user cancelled the keychain prompt — retry when ready.";
  }
  return "Ensure the OS credential store is accessible (keychain unlocked, Secret Service running, etc.).";
}

function buildCopilotCLIAccountName(githubUsername: string): string {
  return `https://github.com:${githubUsername}`;
}

type KeyringModule = typeof import("@napi-rs/keyring");
let _keyringCache: KeyringModule | null | undefined;
let _keyringLoadErrorReason: string | null = null;

function getKeyringUnavailableReason(): string {
  return _keyringLoadErrorReason
    ? `native keyring not available: ${_keyringLoadErrorReason}`
    : "native keyring not available";
}

async function loadKeyring(): Promise<KeyringModule | null> {
  if (_keyringCache !== undefined) return _keyringCache;
  try {
    _keyringCache = await import("@napi-rs/keyring");
    _keyringLoadErrorReason = null;
    return _keyringCache;
  } catch (err) {
    _keyringCache = null;
    _keyringLoadErrorReason = err instanceof Error ? err.message : String(err);
    warn("keychain", `Native keyring import failed: ${_keyringLoadErrorReason}`);
    debug("keychain", "Native keyring not available — keychain integration disabled");
    return null;
  }
}

export async function setCopilotCLIKeychainToken(params: {
  githubUsername: string;
  githubOAuthToken: string;
}): Promise<KeychainResult> {
  const { githubUsername, githubOAuthToken } = params;

  if (!githubUsername || !githubOAuthToken) {
    return { ok: false, reason: "missing username or token" };
  }

  const keyring = await loadKeyring();
  if (!keyring) {
    return { ok: false, reason: getKeyringUnavailableReason() };
  }

  const accountName = buildCopilotCLIAccountName(githubUsername);

  try {
    const entry = new keyring.Entry(COPILOT_CLI_SERVICE, accountName);

    // Check for existing entry — avoid silent clobber
    try {
      const existing = entry.getPassword();
      if (existing === githubOAuthToken) {
        debug("keychain", `Keychain entry for "${githubUsername}" already up to date`);
        return { ok: true };
      }
      // Different token exists — overwrite (we're in a fresh auth flow)
      debug("keychain", `Updating existing keychain entry for "${githubUsername}"`);
    } catch {
      // No existing entry — this is fine, we'll create one
    }

    // Delete-before-write to avoid platform-specific duplicate-item quirks
    try {
      entry.deletePassword();
    } catch {
      // Entry didn't exist — ignore
    }

    entry.setPassword(githubOAuthToken);
    info("keychain", `Saved token to OS credential store for "${githubUsername}"`);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn("keychain", `Failed to write keychain entry for "${githubUsername}": ${reason}`);
    return { ok: false, reason };
  }
}

export async function getCopilotCLIKeychainToken(
  githubUsername: string,
): Promise<string | null> {
  const keyring = await loadKeyring();
  if (!keyring) return null;

  try {
    const entry = new keyring.Entry(
      COPILOT_CLI_SERVICE,
      buildCopilotCLIAccountName(githubUsername),
    );
    return entry.getPassword();
  } catch {
    return null;
  }
}

export async function deleteCopilotCLIKeychainToken(
  githubUsername: string,
): Promise<KeychainResult> {
  if (!githubUsername) {
    return { ok: false, reason: "missing username" };
  }

  const keyring = await loadKeyring();
  if (!keyring) {
    return { ok: false, reason: getKeyringUnavailableReason() };
  }

  try {
    const entry = new keyring.Entry(
      COPILOT_CLI_SERVICE,
      buildCopilotCLIAccountName(githubUsername),
    );
    entry.deletePassword();
    info("keychain", `Removed keychain entry for "${githubUsername}"`);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn("keychain", `Failed to delete keychain entry for "${githubUsername}": ${reason}`);
    return { ok: false, reason };
  }
}

/**
 * Best-effort keychain write — logs on failure but never throws.
 * Call this after successful device-flow auth.
 * Returns the structured result so callers can surface actionable feedback.
 */
export async function bestEffortKeychainWrite(params: {
  githubUsername: string;
  githubOAuthToken: string;
  accountLabel: string;
}): Promise<KeychainResult> {
  const result = await setCopilotCLIKeychainToken({
    githubUsername: params.githubUsername,
    githubOAuthToken: params.githubOAuthToken,
  });
  if (!result.ok) {
    warn(
      "keychain",
      `Could not save "${params.accountLabel}" to OS credential store: ${result.reason}. ` +
        `Hint: ${keychainActionHint(result.reason)} ` +
        `Token is still available through normal OpenCode auth.`,
    );
  }
  return result;
}

/**
 * Best-effort keychain delete — logs on failure but never throws.
 * Call this during account removal.
 * Returns the structured result so callers can surface actionable feedback.
 */
export async function bestEffortKeychainDelete(params: {
  githubUsername: string;
  accountLabel: string;
}): Promise<KeychainResult> {
  const result = await deleteCopilotCLIKeychainToken(params.githubUsername);
  if (!result.ok) {
    warn(
      "keychain",
      `Could not remove "${params.accountLabel}" from OS credential store: ${result.reason}. ` +
        `Hint: ${keychainActionHint(result.reason)}`,
    );
  }
  return result;
}
