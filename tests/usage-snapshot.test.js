import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir, cleanupDir } from "./helpers.js";

test("parseCopilotUsageSnapshot normalizes quota_snapshots payloads", async () => {
  const { parseCopilotUsageSnapshot } = await import("../dist/auth/usage-snapshot.js");

  const snapshot = parseCopilotUsageSnapshot(
    { id: "acct_1", label: "Personal", githubUsername: "ruben" },
    {
      user_id: "12345",
      copilot_plan: "individual_pro",
      quota_reset_date: "2026-04-01",
      quota_snapshots: {
        chat: { entitlement: -1, remaining: -1 },
        completions: { entitlement: 2000, remaining: 1200 },
        premium_interactions: { entitlement: 1500, remaining: 400, overage_permitted: true },
      },
    },
  );

  assert.deepEqual(snapshot, {
    accountId: "acct_1",
    githubUsername: "ruben",
    label: "Personal",
    userId: "12345",
    plan: "individual_pro",
    quotaResetDate: "2026-04-01",
    source: "quota_snapshots",
    buckets: {
      chat: { entitlement: -1, remaining: -1 },
      completions: { entitlement: 2000, remaining: 1200 },
      premiumInteractions: { entitlement: 1500, remaining: 400, overagePermitted: true },
    },
  });
});

test("parseCopilotUsageSnapshot normalizes monthly_quotas payloads", async () => {
  const { parseCopilotUsageSnapshot } = await import("../dist/auth/usage-snapshot.js");

  const snapshot = parseCopilotUsageSnapshot(
    { id: "acct_2", label: "Student", githubUsername: "golam" },
    {
      copilot_plan: "student",
      limited_user_reset_date: "2026-04-15",
      monthly_quotas: { chat: 300, completions: 2000 },
      limited_user_quotas: { chat: 180, completions: 1500 },
    },
  );

  assert.deepEqual(snapshot, {
    accountId: "acct_2",
    githubUsername: "golam",
    label: "Student",
    plan: "student",
    quotaResetDate: "2026-04-15",
    source: "monthly_quotas",
    buckets: {
      chat: { entitlement: 300, remaining: 180 },
      completions: { entitlement: 2000, remaining: 1500 },
    },
  });
});

test("fetchAccountUsageSnapshot uses the stored account token and GitHub endpoint headers", async () => {
  const tempDir = await makeTempDir("copilothydra-usage-");
  const originalFetch = globalThis.fetch;
  const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;


  process.env.OPENCODE_CONFIG_DIR = tempDir;


  try {
    const { upsertSecret } = await import("../dist/storage/secrets.js");
    const { fetchAccountUsageSnapshot } = await import("../dist/auth/usage-snapshot.js");

    await upsertSecret({ accountId: "acct_usage", githubOAuthToken: "gho_usage_token" }, tempDir);

    let capturedRequest = null;
    globalThis.fetch = async (url, init) => {
      capturedRequest = { url: String(url), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({ copilot_plan: "individual_pro", quota_snapshots: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const snapshot = await fetchAccountUsageSnapshot({
      id: "acct_usage",
      label: "Usage",
      githubUsername: "usage-user",
    }, tempDir);

    assert.equal(snapshot.plan, "individual_pro");
    assert.deepEqual(capturedRequest, {
      url: "https://api.github.com/copilot_internal/user",
      headers: new Headers({
        authorization: "token gho_usage_token",
        accept: "application/json",
        "editor-version": "vscode/1.96.2",
        "x-github-api-version": "2025-04-01",
      }),
    });
    assert.equal(capturedRequest.headers.get("authorization"), "token gho_usage_token");
    assert.equal(capturedRequest.headers.get("editor-version"), "vscode/1.96.2");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENCODE_CONFIG_DIR = originalConfigDir;

    await cleanupDir(tempDir);
  }
});

test("formatUsageSnapshotLines renders stable CLI-friendly output", async () => {
  const { formatUsageSnapshotLines } = await import("../dist/auth/usage-snapshot.js");

  const lines = formatUsageSnapshotLines({
    accountId: "acct_3",
    githubUsername: "ruben",
    label: "Personal",
    plan: "individual_pro",
    quotaResetDate: "2026-04-01",
    source: "quota_snapshots",
    buckets: {
      completions: { remaining: 1200, entitlement: 2000 },
      premiumInteractions: { remaining: 400, entitlement: 1500, overagePermitted: true },
    },
  });

  assert.deepEqual(lines, [
    "Personal | ruben",
    "  source: quota_snapshots",
    "  plan: individual_pro",
    "  quota reset: 2026-04-01",
    "  completions: remaining=1200, entitlement=2000",
    "  premium_interactions: remaining=400, entitlement=1500, overage=yes",
  ]);
});
