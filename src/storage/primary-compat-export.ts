import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CopilotAccountMeta } from "../types.js";
import {
  loadCopilotHydraOpenCodeState,
  resolveCopilotHydraOpenCodeStatePath,
  saveCopilotHydraOpenCodeState,
} from "../config/opencode-config.js";
import { loadAccounts } from "./accounts.js";
import { info, warn } from "../log.js";

type PublishStatus = "written" | "skipped-existing" | "skipped-multi-account" | "failed";

interface PublishResult {
  opencodeAuth: PublishStatus;
  ghHosts: PublishStatus;
}

interface ManagedPrimaryCompatibilityState {
  accountId: string;
  opencodeAuthAlias?: boolean;
  ghHostsEntry?: boolean;
}

type MutableState = {
  managedDisabledProviders?: string[];
  managedPrimaryCompatibility?: ManagedPrimaryCompatibilityState;
};

const COPILOT_AUTH_KEYS = [
  "github-copilot",
  "copilot",
  "copilot-chat",
  "github-copilot-chat",
] as const;

export async function bestEffortPublishPrimaryCompatibility(params: {
  account: CopilotAccountMeta;
  githubOAuthToken: string;
  explicit?: boolean;
}): Promise<PublishResult> {
  try {
    return await publishPrimaryCompatibility(params);
  } catch (err) {
    warn("compat", `Primary compatibility export failed for "${params.account.label}": ${String(err)}`);
    return { opencodeAuth: "failed", ghHosts: "failed" };
  }
}

export async function bestEffortCleanupPrimaryCompatibility(params: {
  account: CopilotAccountMeta;
}): Promise<void> {
  try {
    await cleanupPrimaryCompatibility(params.account);
  } catch (err) {
    warn("compat", `Primary compatibility cleanup failed for "${params.account.label}": ${String(err)}`);
  }
}

async function publishPrimaryCompatibility(params: {
  account: CopilotAccountMeta;
  githubOAuthToken: string;
  explicit?: boolean;
}): Promise<PublishResult> {
  const { account, githubOAuthToken, explicit = false } = params;

  if (!explicit) {
    const activeAccounts = (await loadAccounts()).accounts.filter((entry) => entry.lifecycleState === "active");
    if (activeAccounts.length !== 1 || activeAccounts[0]?.id !== account.id) {
      return { opencodeAuth: "skipped-multi-account", ghHosts: "skipped-multi-account" };
    }
  }

  const statePath = resolveCopilotHydraOpenCodeStatePath();
  const state = (await loadCopilotHydraOpenCodeState(statePath)) as MutableState;

  const opencodeAuth = await writeOpenCodePrimaryAuthIfMissing(account, githubOAuthToken);
  const ghHosts = await writeGitHubCliHostsIfMissing(account, githubOAuthToken);

  if (opencodeAuth === "written" || ghHosts === "written") {
    state.managedPrimaryCompatibility = {
      accountId: account.id,
      opencodeAuthAlias: opencodeAuth === "written",
      ghHostsEntry: ghHosts === "written",
    };
    await saveCopilotHydraOpenCodeState(state, statePath);
  }

  return { opencodeAuth, ghHosts };
}

async function cleanupPrimaryCompatibility(account: CopilotAccountMeta): Promise<void> {
  const statePath = resolveCopilotHydraOpenCodeStatePath();
  const state = (await loadCopilotHydraOpenCodeState(statePath)) as MutableState;
  const managed = state.managedPrimaryCompatibility;

  if (!managed || managed.accountId !== account.id) {
    return;
  }

  if (managed.opencodeAuthAlias) {
    await removeManagedOpenCodePrimaryAuth(account.id);
  }

  if (managed.ghHostsEntry) {
    await removeManagedGitHubCliHostsEntry(account.githubUsername);
  }

  delete state.managedPrimaryCompatibility;
  await saveCopilotHydraOpenCodeState(state, statePath);
}

async function writeOpenCodePrimaryAuthIfMissing(
  account: CopilotAccountMeta,
  githubOAuthToken: string,
): Promise<PublishStatus> {
  const path = resolveOpenCodeAuthPath();
  let authData: Record<string, unknown> = {};

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      authData = parsed;
    }
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") {
      return "failed";
    }
  }

  const hasExistingCopilotAuth = COPILOT_AUTH_KEYS.some((key) => {
    const value = authData[key];
    return isRecord(value) && value["type"] === "oauth" && (
      typeof value["refresh"] === "string" || typeof value["access"] === "string"
    );
  });
  if (hasExistingCopilotAuth) {
    return "skipped-existing";
  }

  authData["github-copilot"] = {
    type: "oauth",
    refresh: githubOAuthToken,
    access: githubOAuthToken,
    expires: 0,
    accountId: account.id,
  };

  await saveJsonAtomically(path, authData);
  info("compat", `Exported primary OpenCode auth alias for "${account.label}"`);
  return "written";
}

async function writeGitHubCliHostsIfMissing(
  account: CopilotAccountMeta,
  githubOAuthToken: string,
): Promise<PublishStatus> {
  const path = resolveGitHubCliHostsPath();
  let existing = "";

  try {
    existing = await readFile(path, "utf-8");
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") {
      return "failed";
    }
  }

  if (/^github\.com:\s*$/m.test(existing) || /^\s*oauth_token:\s*\S+\s*$/m.test(existing)) {
    return "skipped-existing";
  }

  const block = [
    "github.com:",
    `  oauth_token: ${githubOAuthToken}`,
    `  user: ${account.githubUsername}`,
    "  git_protocol: https",
    "",
  ].join("\n");

  const next = existing.trim().length > 0
    ? `${existing.replace(/\s*$/, "\n\n")}${block}`
    : block;

  await saveTextAtomically(path, next);
  info("compat", `Exported primary GitHub CLI hosts entry for "${account.label}"`);
  return "written";
}

async function removeManagedOpenCodePrimaryAuth(accountId: string): Promise<void> {
  const path = resolveOpenCodeAuthPath();
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return;

    const entry = parsed["github-copilot"];
    if (isRecord(entry) && entry["accountId"] === accountId) {
      delete parsed["github-copilot"];
      await saveJsonAtomically(path, parsed);
    }
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") {
      throw err;
    }
  }
}

async function removeManagedGitHubCliHostsEntry(githubUsername: string): Promise<void> {
  const path = resolveGitHubCliHostsPath();
  try {
    const raw = await readFile(path, "utf-8");
    const escaped = escapeRegex(githubUsername);
    const withoutGithubSection = raw.replace(
      new RegExp(`(^|\\n)github\\.com:\\n(?:[ \\t].*\\n)*?[ \\t]*user:\\s*${escaped}\\n(?:[ \\t].*\\n)*`, "m"),
      "$1",
    ).trim();

    if (withoutGithubSection === raw.trim()) {
      return;
    }

    if (withoutGithubSection.length === 0) {
      await unlink(path);
      return;
    }

    await saveTextAtomically(path, `${withoutGithubSection}\n`);
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") {
      throw err;
    }
  }
}

function resolveOpenCodeAuthPath(): string {
  const home = process.env["OPENCODE_TEST_HOME"] ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
  if (process.env["XDG_DATA_HOME"]) {
    return join(process.env["XDG_DATA_HOME"], "opencode", "auth.json");
  }
  if (process.platform === "darwin") {
    return join(home, ".local", "share", "opencode", "auth.json");
  }
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
    return join(appData, "opencode", "auth.json");
  }
  return join(home, ".local", "share", "opencode", "auth.json");
}

function resolveGitHubCliHostsPath(): string {
  const home = process.env["OPENCODE_TEST_HOME"] ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
    return join(appData, "GitHub CLI", "hosts.yml");
  }
  return join(home, ".config", "gh", "hosts.yml");
}

async function saveJsonAtomically(path: string, value: Record<string, unknown>): Promise<void> {
  await saveTextAtomically(path, JSON.stringify(value, null, 2) + "\n");
}

async function saveTextAtomically(path: string, text: string): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, text, { encoding: "utf-8", mode: 0o600 });

  if (process.platform === "win32") {
    try {
      try {
        await unlink(path);
      } catch {
        // ignore
      }
      await rename(tmpPath, path);
    } catch {
      await writeFile(path, text, { encoding: "utf-8", mode: 0o600 });
    }
    return;
  }

  await rename(tmpPath, path);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}
