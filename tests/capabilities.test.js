import test from "node:test";
import assert from "node:assert/strict";

test("plan model table matches current documented plan baselines", async () => {
  const {
    modelsForPlan,
  } = await import(`../dist/config/models.js?${Date.now()}`);

  assert.deepEqual(modelsForPlan("free"), [
    "claude-haiku-4.5",
    "goldeneye",
    "gpt-4.1",
    "gpt-5-mini",
    "grok-code-fast-1",
    "raptor-mini",
  ]);

  assert.deepEqual(modelsForPlan("student"), [
    "claude-haiku-4.5",
    "claude-opus-4.5",
    "claude-sonnet-4.5",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.4-mini",
    "grok-code-fast-1",
    "raptor-mini",
  ]);

  assert.deepEqual(modelsForPlan("pro"), [
    "claude-haiku-4.5",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-sonnet-4.6",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "grok-code-fast-1",
    "raptor-mini",
  ]);

  assert.deepEqual(modelsForPlan("pro+"), [
    "claude-haiku-4.5",
    "claude-opus-4.7",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-sonnet-4.6",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "grok-code-fast-1",
    "raptor-mini",
  ]);
});

test("capability mismatch helpers detect entitlement failures and suggest stricter plans", async () => {
  const { isCapabilityMismatchError, buildMismatchMessage } = await import(`../dist/config/capabilities.js?${Date.now()}`);
  const { suggestDowngradePlanForModel } = await import(`../dist/config/models.js?${Date.now()}`);

  assert.equal(isCapabilityMismatchError({ message: "Model not enabled for your plan" }), true);
  assert.equal(isCapabilityMismatchError({ message: "The requested model is not supported" }), true);
  assert.equal(isCapabilityMismatchError({ body: { message: "Model not enabled for your plan" } }), true);
  assert.equal(isCapabilityMismatchError({ reason: { message: "The requested model is not supported" } }), true);
  // Remaining match patterns
  assert.equal(isCapabilityMismatchError({ message: "not authorized to use this copilot feature" }), true);
  assert.equal(isCapabilityMismatchError({ message: "model not enabled for your account" }), true);
  assert.equal(isCapabilityMismatchError({ message: "model not enabled for your org" }), true);
  assert.equal(isCapabilityMismatchError({ message: "access denied by organization policy" }), true);
  assert.equal(isCapabilityMismatchError({ message: "you don't have access to github copilot" }), true);
  assert.equal(isCapabilityMismatchError({ message: "access to this endpoint is forbidden" }), true);
  // Plain string response body
  assert.equal(isCapabilityMismatchError("The requested model is not supported"), true);
  // Non-mismatch 403 body
  assert.equal(isCapabilityMismatchError({ message: "rate limit exceeded" }), false);
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
  assert.match(message, /lower plan tier may match your actual entitlement/);
  assert.match(message, /apply the suggested plan or keep the current declaration/);
  assert.match(message, /review-mismatch acct_test/);
});

test("capability mismatch message explains when no automatic downgrade suggestion is available", async () => {
  const { buildMismatchMessage } = await import(`../dist/config/capabilities.js?${Date.now()}`);

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
    undefined,
  );

  assert.match(message, /No automatic plan suggestion is available/);
  assert.match(message, /enterprise-only or org-restricted/);
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
