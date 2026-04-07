import type { AccountId, CopilotAccountMeta } from "../types.js";
import { findSecret, upsertSecret } from "../storage/secrets.js";
import { readFile } from "node:fs/promises";
import { candidateOpenCodeAuthPaths } from "./auth-path.js";

export const COPILOT_USAGE_SNAPSHOT_URL = "https://api.github.com/copilot_internal/user";
export const COPILOT_USAGE_API_VERSION = "2025-04-01";
export const COPILOT_USAGE_EDITOR_VERSION = "vscode/1.96.2";

export interface CopilotUsageBucket {
  entitlement?: number;
  remaining?: number;
  overagePermitted?: boolean;
}

export interface CopilotUsageSnapshot {
  accountId: AccountId;
  githubUsername: string;
  label: string;
  userId?: string;
  plan?: string;
  quotaResetDate?: string;
  source: "quota_snapshots" | "monthly_quotas" | "unknown";
  buckets: {
    chat?: CopilotUsageBucket;
    completions?: CopilotUsageBucket;
    premiumInteractions?: CopilotUsageBucket;
  };
}

export async function fetchAccountUsageSnapshot(
  account: CopilotAccountMeta,
  configDir?: string,
): Promise<CopilotUsageSnapshot> {
  let secret = await findSecret(account.id, configDir);
  if (!secret) {
    const recoveredToken = await recoverOAuthTokenFromOpenCodeAuth(account);
    if (recoveredToken) {
      await upsertSecret({
        accountId: account.id,
        githubOAuthToken: recoveredToken,
      }, configDir);
      secret = { accountId: account.id, githubOAuthToken: recoveredToken };
    }
  }

  if (!secret) {
    throw new Error(`[copilothydra] no stored oauth token found for account "${account.label}" (${account.githubUsername})`);
  }

  const response = await fetch(COPILOT_USAGE_SNAPSHOT_URL, {
    headers: {
      Authorization: `token ${secret.githubOAuthToken}`,
      Accept: "application/json",
      "Editor-Version": COPILOT_USAGE_EDITOR_VERSION,
      "X-GitHub-Api-Version": COPILOT_USAGE_API_VERSION,
    },
  });

  if (!response.ok) {
    throw new Error(
      `[copilothydra] usage snapshot request failed for account "${account.label}" (${account.githubUsername}): ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json() as Record<string, unknown>;
  return parseCopilotUsageSnapshot(account, payload);
}

async function recoverOAuthTokenFromOpenCodeAuth(
  account: Pick<CopilotAccountMeta, "providerId">,
): Promise<string | null> {
  for (const path of candidateOpenCodeAuthPaths()) {
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const entry = parsed[account.providerId];
      if (!isRecord(entry) || entry["type"] !== "oauth") {
        continue;
      }
      const refresh = typeof entry["refresh"] === "string" ? entry["refresh"] : undefined;
      const access = typeof entry["access"] === "string" ? entry["access"] : undefined;
      return refresh ?? access ?? null;
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        continue;
      }
      // Non-ENOENT error (corrupt/permission) — skip this path, try next
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

export function parseCopilotUsageSnapshot(
  account: Pick<CopilotAccountMeta, "id" | "githubUsername" | "label">,
  payload: Record<string, unknown>,
): CopilotUsageSnapshot {
  const quotaSnapshots = asRecord(payload["quota_snapshots"]);
  if (quotaSnapshots) {
    const snapshot = buildBaseSnapshot(account, payload, "quota_snapshots");
    const chat = parseBucket(quotaSnapshots["chat"]);
    const completions = parseBucket(quotaSnapshots["completions"]);
    const premiumInteractions = parseBucket(quotaSnapshots["premium_interactions"]);
    return {
      ...snapshot,
      buckets: definedBuckets({ chat, completions, premiumInteractions }),
    };
  }

  const monthlyQuotas = asRecord(payload["monthly_quotas"]);
  const limitedUserQuotas = asRecord(payload["limited_user_quotas"]);
  if (monthlyQuotas || limitedUserQuotas) {
    const snapshot = buildBaseSnapshot(account, payload, "monthly_quotas");
    const chat = bucketFromNumbers(asNumber(monthlyQuotas?.["chat"]), asNumber(limitedUserQuotas?.["chat"]));
    const completions = bucketFromNumbers(
      asNumber(monthlyQuotas?.["completions"]),
      asNumber(limitedUserQuotas?.["completions"]),
    );
    const result: CopilotUsageSnapshot = {
      ...snapshot,
      buckets: definedBuckets({ chat, completions }),
    };
    if (typeof payload["limited_user_reset_date"] === "string") {
      result.quotaResetDate = payload["limited_user_reset_date"];
    }
    return result;
  }

  return {
    ...buildBaseSnapshot(account, payload, "unknown"),
    buckets: {},
  };
}

export function formatUsageSnapshotLines(snapshot: CopilotUsageSnapshot): string[] {
  const lines = [`${snapshot.label} | ${snapshot.githubUsername}`];
  lines.push(`  source: ${snapshot.source}`);
  if (snapshot.plan) {
    lines.push(`  plan: ${snapshot.plan}`);
  }
  if (snapshot.quotaResetDate) {
    lines.push(`  quota reset: ${snapshot.quotaResetDate}`);
  }
  if (snapshot.userId) {
    lines.push(`  user id: ${snapshot.userId}`);
  }

  const buckets: Array<[string, CopilotUsageBucket | undefined]> = [
    ["chat", snapshot.buckets.chat],
    ["completions", snapshot.buckets.completions],
    ["premium_interactions", snapshot.buckets.premiumInteractions],
  ];

  for (const [name, bucket] of buckets) {
    if (!bucket) continue;
    const parts: string[] = [];
    if (bucket.remaining !== undefined) parts.push(`remaining=${bucket.remaining}`);
    if (bucket.entitlement !== undefined) parts.push(`entitlement=${bucket.entitlement}`);
    if (bucket.overagePermitted !== undefined) parts.push(`overage=${bucket.overagePermitted ? "yes" : "no"}`);
    if (parts.length > 0) {
      lines.push(`  ${name}: ${parts.join(", ")}`);
    }
  }

  return lines;
}

function parseBucket(value: unknown): CopilotUsageBucket | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const bucket: CopilotUsageBucket = {};
  const entitlement = asNumber(record["entitlement"]);
  const remaining = asNumber(record["remaining"]);
  const overagePermitted = typeof record["overage_permitted"] === "boolean"
    ? record["overage_permitted"]
    : undefined;
  if (entitlement !== undefined) bucket.entitlement = entitlement;
  if (remaining !== undefined) bucket.remaining = remaining;
  if (overagePermitted !== undefined) bucket.overagePermitted = overagePermitted;
  return Object.keys(bucket).length > 0 ? bucket : undefined;
}

function bucketFromNumbers(entitlement: number | undefined, remaining: number | undefined): CopilotUsageBucket | undefined {
  const bucket: CopilotUsageBucket = {};
  if (entitlement !== undefined) bucket.entitlement = entitlement;
  if (remaining !== undefined) bucket.remaining = remaining;
  return Object.keys(bucket).length > 0 ? bucket : undefined;
}

function buildBaseSnapshot(
  account: Pick<CopilotAccountMeta, "id" | "githubUsername" | "label">,
  payload: Record<string, unknown>,
  source: CopilotUsageSnapshot["source"],
): Omit<CopilotUsageSnapshot, "buckets"> {
  const snapshot: Omit<CopilotUsageSnapshot, "buckets"> = {
    accountId: account.id,
    githubUsername: account.githubUsername,
    label: account.label,
    source,
  };

  if (typeof payload["user_id"] === "string") snapshot.userId = payload["user_id"];
  if (typeof payload["copilot_plan"] === "string") snapshot.plan = payload["copilot_plan"];
  if (typeof payload["quota_reset_date"] === "string") snapshot.quotaResetDate = payload["quota_reset_date"];

  return snapshot;
}

function definedBuckets(
  buckets: Record<string, CopilotUsageBucket | undefined>,
): CopilotUsageSnapshot["buckets"] {
  const result: CopilotUsageSnapshot["buckets"] = {};
  for (const [key, value] of Object.entries(buckets)) {
    if (value !== undefined) {
      result[key as keyof CopilotUsageSnapshot["buckets"]] = value;
    }
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
