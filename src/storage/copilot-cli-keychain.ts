/**
 * CopilotHydra — copilot-cli-compatible Keychain integration
 *
 * Writes GitHub OAuth tokens into the OS credential store using the same
 * format that `copilot-cli` uses, so that OpenCode Bar, AIUsageTracker,
 * opencode-quota, and native GitHub Copilot can discover them.
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

function buildCopilotCLIAccountName(githubUsername: string): string {
  return `https://github.com:${githubUsername}`;
}

type KeyringModule = typeof import("@napi-rs/keyring");
let _keyringCache: KeyringModule | null | undefined;

async function loadKeyring(): Promise<KeyringModule | null> {
  if (_keyringCache !== undefined) return _keyringCache;
  try {
    _keyringCache = await import("@napi-rs/keyring");
    return _keyringCache;
  } catch {
    _keyringCache = null;
    debug("keychain", "Native keyring not available — keychain integration disabled");
    return null;
  }
}

export async function setCopilotCLIKeychainToken(params: {
  githubUsername: string;
  githubOAuthToken: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { githubUsername, githubOAuthToken } = params;

  if (!githubUsername || !githubOAuthToken) {
    return { ok: false, reason: "missing username or token" };
  }

  const keyring = await loadKeyring();
  if (!keyring) {
    return { ok: false, reason: "native keyring not available" };
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
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!githubUsername) {
    return { ok: false, reason: "missing username" };
  }

  const keyring = await loadKeyring();
  if (!keyring) {
    return { ok: false, reason: "native keyring not available" };
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
 * Best-effort keychain write — logs but never throws.
 * Call this after successful device-flow auth.
 */
export async function bestEffortKeychainWrite(params: {
  githubUsername: string;
  githubOAuthToken: string;
  accountLabel: string;
}): Promise<void> {
  const result = await setCopilotCLIKeychainToken({
    githubUsername: params.githubUsername,
    githubOAuthToken: params.githubOAuthToken,
  });
  if (!result.ok) {
    warn(
      "keychain",
      `Could not save "${params.accountLabel}" to OS credential store: ${result.reason}. ` +
        `Token is still available through normal OpenCode auth.`,
    );
  }
}

/**
 * Best-effort keychain delete — logs but never throws.
 * Call this during account removal.
 */
export async function bestEffortKeychainDelete(params: {
  githubUsername: string;
  accountLabel: string;
}): Promise<void> {
  const result = await deleteCopilotCLIKeychainToken(params.githubUsername);
  if (!result.ok) {
    warn(
      "keychain",
      `Could not remove "${params.accountLabel}" from OS credential store: ${result.reason}`,
    );
  }
}
