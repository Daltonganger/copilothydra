import test from "node:test";
import assert from "node:assert/strict";

function makeAccount(plan) {
  return {
    id: `acct_${plan}`,
    providerId: `github-copilot-acct-acct_${plan}`,
    label: `Label ${plan}`,
    githubUsername: `user-${plan}`,
    plan,
    capabilityState: "user-declared",
    lifecycleState: "active",
    addedAt: "2026-03-27T00:00:00.000Z",
  };
}

test("model tier table only references cataloged model ids", async () => {
  const {
    COPILOT_MODEL_CATALOG,
    MODEL_TIER_TABLE,
    PLAN_TIER_ORDER,
    isKnownCopilotModelId,
  } = await import(`../dist/config/models.js?${Date.now()}`);

  for (const plan of PLAN_TIER_ORDER) {
    const entries = MODEL_TIER_TABLE[plan] ?? [];
    assert.ok(entries.length > 0, `expected at least one model for plan ${plan}`);

    for (const entry of entries) {
      assert.equal(
        isKnownCopilotModelId(entry.id),
        true,
        `plan ${plan} references uncataloged model id ${entry.id}`,
      );
      assert.ok(COPILOT_MODEL_CATALOG[entry.id], `missing catalog entry for ${entry.id}`);
    }
  }
});

test("provider model display names always resolve from the catalog for exposed plan models", async () => {
  const { COPILOT_MODEL_CATALOG, PLAN_TIER_ORDER, modelsForPlan } = await import(`../dist/config/models.js?${Date.now()}`);
  const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);

  for (const plan of PLAN_TIER_ORDER) {
    const provider = buildProviderConfig(makeAccount(plan));
    const providerModels = provider.models ?? {};
    const expectedModelIds = modelsForPlan(plan, { includeUnverified: false });

    assert.deepEqual(Object.keys(providerModels).sort(), [...expectedModelIds].sort());

    for (const modelId of expectedModelIds) {
      assert.equal(
        providerModels[modelId]?.name,
        COPILOT_MODEL_CATALOG[modelId]?.name,
        `provider display name for ${modelId} should come from catalog`,
      );
    }
  }
});

test("catalog entries are internally consistent", async () => {
  const { COPILOT_MODEL_CATALOG } = await import(`../dist/config/models.js?${Date.now()}`);

  for (const modelId of Object.keys(COPILOT_MODEL_CATALOG)) {
    const entry = COPILOT_MODEL_CATALOG[modelId];
    assert.equal(entry.id, modelId, `catalog entry id mismatch for ${modelId}`);
    assert.ok(entry.name, `catalog entry ${modelId} is missing a display name`);
  }
});
