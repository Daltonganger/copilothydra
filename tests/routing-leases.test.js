import test from "node:test";
import assert from "node:assert/strict";

test("acquireRoutingLease tracks in-flight requests and releases idempotently", async () => {
  const routing = await import(`../dist/routing/provider-account-map.js?${Date.now()}`);

  routing.registerAccounts([
    {
      id: "acct_one",
      providerId: "github-copilot-acct-acct_one",
      label: "One",
      githubUsername: "one",
      plan: "free",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const lease = routing.acquireRoutingLease("github-copilot-acct-acct_one");
  assert.equal(lease.accountId, "acct_one");
  assert.equal(routing.getInFlightCount("acct_one"), 1);

  lease.release();
  assert.equal(routing.getInFlightCount("acct_one"), 0);

  lease.release();
  assert.equal(routing.getInFlightCount("acct_one"), 0);
});

test("pending-removal blocks new leases but allows drain completion checks", async () => {
  const routing = await import(`../dist/routing/provider-account-map.js?${Date.now()}`);

  routing.registerAccounts([
    {
      id: "acct_two",
      providerId: "github-copilot-acct-acct_two",
      label: "Two",
      githubUsername: "two",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const lease = routing.acquireRoutingLease("github-copilot-acct-acct_two");
  routing.markAccountPendingRemoval("acct_two");

  assert.equal(routing.canAccountDrainComplete("acct_two"), false);
  assert.throws(
    () => routing.acquireRoutingLease("github-copilot-acct-acct_two"),
    /pending removal/
  );

  lease.release();
  assert.equal(routing.canAccountDrainComplete("acct_two"), true);
});

test("routing snapshot exposes lifecycle and in-flight counts", async () => {
  const routing = await import(`../dist/routing/provider-account-map.js?${Date.now()}`);

  routing.registerAccounts([
    {
      id: "acct_three",
      providerId: "github-copilot-acct-acct_three",
      label: "Three",
      githubUsername: "three",
      plan: "student",
      capabilityState: "verified",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const lease = routing.acquireRoutingLease("github-copilot-acct-acct_three");
  const snapshot = routing.getRoutingSnapshot();

  assert.equal(snapshot.length, 1);
  assert.deepEqual(snapshot[0], {
    accountId: "acct_three",
    providerId: "github-copilot-acct-acct_three",
    lifecycleState: "active",
    inFlight: 1,
  });

  lease.release();
});
