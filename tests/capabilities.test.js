import test from "node:test";
import assert from "node:assert/strict";

test("plan model policy filters override-required entries unless explicitly included", async () => {
  const { modelsForPlan, getOverrideRequiredModelsForPlan } = await import(`../dist/config/models.js?${Date.now()}`);

  assert.deepEqual(getOverrideRequiredModelsForPlan("pro"), ["claude-3.7-sonnet", "o1", "o1-mini"]);
  assert.deepEqual(modelsForPlan("pro", { includeUnverified: false }), [
    "gpt-4o-mini",
    "gpt-4o",
    "claude-3.5-haiku",
    "claude-3.5-sonnet",
    "o3-mini",
  ]);
  assert.ok(modelsForPlan("pro", { includeUnverified: true }).includes("o1"));
});

test("capability mismatch helpers detect entitlement failures and suggest stricter plans", async () => {
  const { isCapabilityMismatchError, buildMismatchMessage } = await import(`../dist/config/capabilities.js?${Date.now()}`);
  const { suggestDowngradePlanForModel } = await import(`../dist/config/models.js?${Date.now()}`);

  assert.equal(isCapabilityMismatchError({ message: "Model not enabled for your plan" }), true);
  assert.equal(isCapabilityMismatchError({ message: "rate limited" }), false);
  assert.equal(suggestDowngradePlanForModel("pro", "o1"), "student");
  assert.equal(suggestDowngradePlanForModel("free", "gpt-4o-mini"), undefined);

  const message = buildMismatchMessage(
    {
      id: "acct_test",
      providerId: "github-copilot-acct-acct_test",
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
      capabilityState: "mismatch",
      lifecycleState: "active",
      addedAt: "2026-03-25T00:00:00.000Z",
    },
    "o1",
    "student",
  );

  assert.match(message, /Capability mismatch detected/);
  assert.match(message, /Model "o1" was rejected/);
  assert.match(message, /review-mismatch acct_test/);
});
