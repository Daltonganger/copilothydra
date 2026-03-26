import test from "node:test";
import assert from "node:assert/strict";

test("plan model table matches current documented plan baselines", async () => {
  const {
    getOverrideRequiredModelsForPlan,
    modelsForPlan,
  } = await import(`../dist/config/models.js?${Date.now()}`);

  assert.deepEqual(getOverrideRequiredModelsForPlan("free"), []);
  assert.deepEqual(getOverrideRequiredModelsForPlan("student"), []);
  assert.deepEqual(getOverrideRequiredModelsForPlan("pro"), []);
  assert.deepEqual(getOverrideRequiredModelsForPlan("pro+"), []);

  assert.deepEqual(modelsForPlan("free", { includeUnverified: false }), [
    "claude-haiku-4.5",
    "gpt-4.1",
    "gpt-5-mini",
    "grok-code-fast-1",
  ]);

  assert.deepEqual(modelsForPlan("student", { includeUnverified: false }), [
    "claude-haiku-4.5",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-pro-preview",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1-codex-max",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "grok-code-fast-1",
  ]);

  assert.deepEqual(modelsForPlan("pro", { includeUnverified: false }), [
    "claude-haiku-4.5",
    "claude-opus-4.5",
    "claude-opus-4.6",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-sonnet-4.6",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-pro-preview",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1-codex-max",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "grok-code-fast-1",
  ]);

  assert.deepEqual(modelsForPlan("pro+", { includeUnverified: false }), [
    "claude-haiku-4.5",
    "claude-opus-4.5",
    "claude-opus-4.6",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-sonnet-4.6",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-pro-preview",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1-codex-max",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "grok-code-fast-1",
  ]);

  assert.deepEqual(modelsForPlan("pro+", { includeUnverified: true }), modelsForPlan("pro+", { includeUnverified: false }));
});

test("capability mismatch helpers detect entitlement failures and suggest stricter plans", async () => {
  const { isCapabilityMismatchError, buildMismatchMessage } = await import(`../dist/config/capabilities.js?${Date.now()}`);
  const { suggestDowngradePlanForModel } = await import(`../dist/config/models.js?${Date.now()}`);

  assert.equal(isCapabilityMismatchError({ message: "Model not enabled for your plan" }), true);
  assert.equal(isCapabilityMismatchError({ message: "The requested model is not supported" }), true);
  assert.equal(isCapabilityMismatchError({ message: "rate limited" }), false);
  assert.equal(suggestDowngradePlanForModel("pro", "gpt-5.4"), "student");
  assert.equal(suggestDowngradePlanForModel("free", "gpt-4.1"), undefined);

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
    "gpt-5.4",
    "student",
  );

  assert.match(message, /Capability mismatch detected/);
  assert.match(message, /Model "gpt-5.4" was rejected/);
  assert.match(message, /review-mismatch acct_test/);
});

test("runtime readiness no longer warns about GPT-5+/Codex hiding once Hydra mirrors built-in routing", async () => {
  const { checkAccountRuntimeReadiness } = await import(`../dist/runtime-checks.js?${Date.now()}`);

  const result = checkAccountRuntimeReadiness({
    id: "acct_test",
    providerId: "github-copilot-acct-acct_test",
    label: "Personal",
    githubUsername: "alice",
    plan: "pro",
    capabilityState: "user-declared",
    lifecycleState: "active",
    addedAt: "2026-03-25T00:00:00.000Z",
  });

  assert.equal(result.warnings.some((warning) => warning.includes("GPT-5+/Codex")), false);
});
