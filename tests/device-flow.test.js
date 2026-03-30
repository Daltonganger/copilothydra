import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers for creating mock fetch responses
// ---------------------------------------------------------------------------

/** Build a JSON Response with the given status and body. */
function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// requestDeviceCode
// ---------------------------------------------------------------------------

test("requestDeviceCode – happy path returns device_code, user_code, verification_uri, interval", async () => {
  const { requestDeviceCode } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  let capturedBody;

  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return jsonResp({
      device_code: "dc_12345",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
  };

  try {
    const result = await requestDeviceCode();

    assert.equal(result.device_code, "dc_12345");
    assert.equal(result.user_code, "ABCD-1234");
    assert.equal(result.verification_uri, "https://github.com/login/device");
    assert.equal(result.expires_in, 900);
    assert.equal(result.interval, 5);

    // Verify the POST body includes client_id and scope
    assert.equal(capturedBody.client_id, "Ov23li8tweQw6odWQebz");
    assert.equal(capturedBody.scope, "read:user");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestDeviceCode – HTTP error throws DeviceFlowError with request_failed code", async () => {
  const { requestDeviceCode, DeviceFlowError } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("bad", { status: 422, statusText: "Unprocessable Entity" });

  try {
    await assert.rejects(() => requestDeviceCode(), (err) => {
      assert.ok(err instanceof DeviceFlowError);
      assert.equal(err.code, "request_failed");
      assert.match(err.message, /422/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestDeviceCode – network failure propagates", async () => {
  const { requestDeviceCode } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network error"); };

  try {
    await assert.rejects(() => requestDeviceCode(), (err) => {
      assert.ok(err instanceof TypeError);
      assert.equal(err.message, "network error");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// pollForAccessToken
// ---------------------------------------------------------------------------

test("pollForAccessToken – happy path returns access token on first poll", async () => {
  const { pollForAccessToken } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResp({
      access_token: "gho_token123",
      token_type: "bearer",
      scope: "read:user",
    });

  try {
    // Use a very short interval (0) so the test doesn't wait, but deadline must be in the future
    const result = await pollForAccessToken("dc_12345", 0, 900);
    assert.equal(result.accessToken, "gho_token123");
    assert.equal(result.scope, "read:user");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollForAccessToken – slow_down increases interval then succeeds", async () => {
  const { pollForAccessToken } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  // Track sleep durations requested via setTimeout
  const sleepDurations = [];
  globalThis.setTimeout = (fn, ms) => {
    sleepDurations.push(ms);
    // Resolve immediately so tests don't actually wait
    fn();
    return 0;
  };

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return jsonResp({ error: "slow_down", error_description: "please slow down" });
    }
    return jsonResp({ access_token: "gho_slow_ok", token_type: "bearer", scope: "read:user" });
  };

  try {
    const result = await pollForAccessToken("dc_slow", 0, 900);

    assert.equal(result.accessToken, "gho_slow_ok");
    assert.equal(callCount, 2);

    // First sleep is the initial interval (0 * 1000 = 0ms)
    // Second sleep should be 0 + 5000 = 5000 (slow_down adds 5000)
    assert.ok(sleepDurations.length >= 2, `expected >= 2 sleeps, got ${sleepDurations.length}`);
    assert.equal(sleepDurations[1], 5000, "slow_down should add 5000ms to interval");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("pollForAccessToken – authorization_pending then success", async () => {
  const { pollForAccessToken } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  // Bounce setTimeout immediately
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return jsonResp({ error: "authorization_pending", error_description: "still waiting" });
    }
    return jsonResp({ access_token: "gho_pending_ok", token_type: "bearer", scope: "read:user" });
  };

  try {
    const result = await pollForAccessToken("dc_pending", 1, 900);
    assert.equal(result.accessToken, "gho_pending_ok");
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("pollForAccessToken – expired_token throws DeviceFlowError", async () => {
  const { pollForAccessToken, DeviceFlowError } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  globalThis.fetch = async () =>
    jsonResp({ error: "expired_token", error_description: "token has expired" });

  try {
    await assert.rejects(() => pollForAccessToken("dc_expired", 1, 900), (err) => {
      assert.ok(err instanceof DeviceFlowError);
      assert.equal(err.code, "expired_token");
      assert.match(err.message, /expired/i);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("pollForAccessToken – access_denied throws DeviceFlowError", async () => {
  const { pollForAccessToken, DeviceFlowError } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  globalThis.fetch = async () =>
    jsonResp({ error: "access_denied", error_description: "user denied" });

  try {
    await assert.rejects(() => pollForAccessToken("dc_denied", 1, 900), (err) => {
      assert.ok(err instanceof DeviceFlowError);
      assert.equal(err.code, "access_denied");
      assert.match(err.message, /denied/i);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("pollForAccessToken – timeout when deadline passes without token", async () => {
  const { pollForAccessToken, DeviceFlowError } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  // Make setTimeout resolve immediately so we iterate fast
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  // Always return authorization_pending — we'll exhaust the deadline
  globalThis.fetch = async () =>
    jsonResp({ error: "authorization_pending", error_description: "waiting" });

  // expiresIn = 0 means deadline = Date.now(), so the while loop won't enter
  // But we need it to enter at least once. Use a negative trick: expiresIn = -1
  // Actually: deadline = Date.now() + 0 = Date.now(), the while check is `Date.now() < deadline`
  // which is false immediately. Let's use expiresIn = 0 and verify the timeout is thrown.
  try {
    await assert.rejects(() => pollForAccessToken("dc_timeout", 1, 0), (err) => {
      assert.ok(err instanceof DeviceFlowError);
      assert.equal(err.code, "timeout");
      assert.match(err.message, /timed out/i);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("pollForAccessToken – unexpected error throws DeviceFlowError with the error code", async () => {
  const { pollForAccessToken, DeviceFlowError } = await import("../dist/auth/device-flow.js");

  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 0; };

  globalThis.fetch = async () =>
    jsonResp({ error: "some_new_error", error_description: "something unexpected" });

  try {
    await assert.rejects(() => pollForAccessToken("dc_unexpected", 1, 900), (err) => {
      assert.ok(err instanceof DeviceFlowError);
      assert.equal(err.code, "some_new_error");
      assert.match(err.message, /unexpected/i);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});
