import test from "node:test";
import assert from "node:assert/strict";

test("renderAccountManagerScreen shows empty-state guidance", async () => {
  const { renderAccountManagerScreen } = await import(`../dist/ui/menu.js?${Date.now()}`);

  const screen = renderAccountManagerScreen([]);
  assert.match(screen, /GitHub Copilot Multi-Account Manager/);
  assert.match(screen, /No CopilotHydra accounts configured yet/);
  assert.match(screen, /Primary action: Add account/);
});

test("renderAccountManagerScreen shows account capability and lifecycle states", async () => {
  const { renderAccountManagerScreen } = await import(`../dist/ui/menu.js?${Date.now()}`);

  const screen = renderAccountManagerScreen([
    {
      id: "acct_one",
      providerId: "github-copilot-acct-acct_one",
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: "2026-03-25T00:00:00.000Z",
    },
    {
      id: "acct_two",
      providerId: "github-copilot-acct-acct_two",
      label: "Work",
      githubUsername: "bob",
      plan: "student",
      capabilityState: "mismatch",
      mismatchSuggestedPlan: "free",
      lifecycleState: "pending-removal",
      addedAt: "2026-03-25T00:00:00.000Z",
    },
  ], { restartRequired: true });

  assert.match(screen, /Restart required/);
  assert.match(screen, /Personal \(alice\) \[PRO\] \| user-declared \| active/);
  assert.match(screen, /Work \(bob\) \[STUDENT\] \| ⚠ mismatch \| pending-removal/);
  assert.match(screen, /suggested FREE/);
});
