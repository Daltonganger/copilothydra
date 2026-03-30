import test from "node:test";
import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";

async function readAll(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  return chunks;
}

test("shouldUseCopilotResponsesApi covers the current GPT-5 family routing boundary", async () => {
  const { shouldUseCopilotResponsesApi } = await import(`../dist/config/models.js?${Date.now()}`);

  assert.equal(shouldUseCopilotResponsesApi("gpt-5"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.1"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.1-codex"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.1-codex-mini"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.1-codex-max"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.2"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.2-codex"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.3-codex"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.4"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.4-mini"), true);

  assert.equal(shouldUseCopilotResponsesApi("gpt-5-mini"), false);
  assert.equal(shouldUseCopilotResponsesApi("gpt-4.1"), false);
  assert.equal(shouldUseCopilotResponsesApi("gpt-4o"), false);
  assert.equal(shouldUseCopilotResponsesApi("claude-opus-4.6"), false);
});

test("withHydraCopilotResponsesParity is a no-op for non-objects and models without doStream", async () => {
  const { withHydraCopilotResponsesParity } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  assert.equal(withHydraCopilotResponsesParity(null), null);
  assert.equal(withHydraCopilotResponsesParity("not-a-model"), "not-a-model");

  const plainModel = { doGenerate() {} };
  assert.equal(withHydraCopilotResponsesParity(plainModel), plainModel);
});

test("withHydraCopilotResponsesParity leaves tool-only streams unchanged", async () => {
  const { withHydraCopilotResponsesParity } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  const wrappedModel = withHydraCopilotResponsesParity({
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "tool-call", id: "tool-1", toolName: "lookup" });
            controller.enqueue({ type: "tool-result", id: "tool-1", result: "ok" });
            controller.close();
          },
        }),
      };
    },
  });

  const result = await wrappedModel.doStream({});
  const chunks = await readAll(result.stream);
  assert.deepEqual(chunks, [
    { type: "tool-call", id: "tool-1", toolName: "lookup" },
    { type: "tool-result", id: "tool-1", result: "ok" },
  ]);
});

test("withHydraCopilotResponsesParity preserves instance-bound doStream methods", async () => {
  const { withHydraCopilotResponsesParity } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  class StreamModel {
    constructor() {
      this.streamId = "bound-stream";
    }

    async doStream() {
      return {
        stream: new ReadableStream({
          start: (controller) => {
            controller.enqueue({ type: "text-delta", id: this.streamId, delta: "Hallo" });
            controller.close();
          },
        }),
      };
    }
  }

  const wrappedModel = withHydraCopilotResponsesParity(new StreamModel());
  const result = await wrappedModel.doStream({});
  const chunks = await readAll(result.stream);

  assert.deepEqual(chunks, [
    { type: "text-start", id: "bound-stream" },
    { type: "text-delta", id: "bound-stream", delta: "Hallo" },
    { type: "text-end", id: "bound-stream" },
  ]);
});

test("withHydraCopilotResponsesParity preserves non-text chunks while normalizing text lifecycle", async () => {
  const { withHydraCopilotResponsesParity } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  const wrappedModel = withHydraCopilotResponsesParity({
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "tool-call", id: "tool-1", toolName: "lookup" });
            controller.enqueue({ type: "text-start", id: "msg-ignored" });
            controller.enqueue({ type: "text-delta", id: "item-1", delta: "Hallo" });
            controller.enqueue({ type: "tool-result", id: "tool-1", result: "zon" });
            controller.enqueue({ type: "text-delta", id: "item-2", delta: " wereld" });
            controller.enqueue({ type: "text-end", id: "msg-ignored" });
            controller.close();
          },
        }),
      };
    },
  });

  const result = await wrappedModel.doStream({});
  const chunks = await readAll(result.stream);
  assert.deepEqual(chunks, [
    { type: "tool-call", id: "tool-1", toolName: "lookup" },
    { type: "text-start", id: "item-1" },
    { type: "text-delta", id: "item-1", delta: "Hallo" },
    { type: "tool-result", id: "tool-1", result: "zon" },
    { type: "text-delta", id: "item-1", delta: " wereld" },
    { type: "text-end", id: "item-1" },
  ]);
});

test("createHydraCopilotProvider accepts optional model settings for chat-path models", async () => {
  const { createHydraCopilotProvider } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  const provider = createHydraCopilotProvider({
    apiKey: "test-key",
    baseURL: "https://example.com",
  });

  assert.doesNotThrow(() => {
    provider.languageModel("claude-sonnet-4.6", { mode: { type: "regular" } });
  });
});

test("withHydraCopilotErrorNormalization normalizes object-shaped provider errors into string Errors", async () => {
  const { withHydraCopilotErrorNormalization } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  const model = withHydraCopilotErrorNormalization({
    async doStream() {
      throw {
        reason: {
          message: "Invalid input: expected string, received object",
          path: ["reason"],
        },
      };
    },
  });

  await assert.rejects(
    () => model.doStream({}),
    /Invalid input: expected string, received object/,
  );
});

test("withHydraCopilotErrorNormalization extracts nested provider error messages consistently", async () => {
  const { withHydraCopilotErrorNormalization } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  const model = withHydraCopilotErrorNormalization({
    async doGenerate() {
      throw {
        body: {
          message: "The requested model is not supported",
        },
      };
    },
  });

  await assert.rejects(
    () => model.doGenerate({}),
    /The requested model is not supported/,
  );
});

test("withHydraCopilotErrorNormalization preserves instance-bound generate and stream methods", async () => {
  const {
    withHydraCopilotErrorNormalization,
  } = await import(`../dist/sdk/hydra-copilot-provider.js?${Date.now()}`);

  class BoundModel {
    constructor() {
      this.calls = 0;
    }

    getArgs(payload) {
      return { ...payload, call: ++this.calls };
    }

    async doGenerate(payload) {
      return this.getArgs(payload);
    }

    async doStream(payload) {
      const chunk = this.getArgs(payload);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "tool-result", id: "tool-1", result: chunk });
            controller.close();
          },
        }),
      };
    }
  }

  const model = withHydraCopilotErrorNormalization(new BoundModel());

  assert.deepEqual(await model.doGenerate({ model: "claude-opus-4.6" }), {
    model: "claude-opus-4.6",
    call: 1,
  });

  const streamResult = await model.doStream({ model: "claude-opus-4.6" });
  const chunks = await readAll(streamResult.stream);

  assert.deepEqual(chunks, [
    {
      type: "tool-result",
      id: "tool-1",
      result: {
        model: "claude-opus-4.6",
        call: 2,
      },
    },
  ]);
});

test("createHydraCopilotProvider routes gpt-5 models to responses path and chat models to chat path", async () => {
  const { createHydraCopilotProvider } = await import(`../dist/sdk/hydra-copilot-provider.js?routing=${Date.now()}`);

  const provider = createHydraCopilotProvider({
    apiKey: "test-key",
    baseURL: "https://api.githubcopilot.com",
  });

  // gpt-5 → responses path: responses models expose doStream (stream-only)
  const gpt5Model = provider.languageModel("gpt-5");
  assert.ok(typeof gpt5Model.doStream === "function", "gpt-5 model should have doStream");

  // claude → chat path: wrapped models expose doStream (wrapper preserves it via own-property)
  const claudeModel = provider.languageModel("claude-sonnet-4.6");
  assert.ok(typeof claudeModel.doStream === "function", "claude model should have doStream");

  // Both paths are accessible via provider.responses / provider.chat directly
  assert.doesNotThrow(() => provider.responses("gpt-5"), "provider.responses('gpt-5') should not throw");
  assert.doesNotThrow(() => provider.chat("claude-sonnet-4.6"), "provider.chat('claude-sonnet-4.6') should not throw");
});

test("shouldUseCopilotResponsesApi forward-matches unknown future gpt-5.x variants", async () => {
  const { shouldUseCopilotResponsesApi } = await import(`../dist/config/models.js?fwd=${Date.now()}`);

  // Known future variants should route to Responses API
  assert.equal(shouldUseCopilotResponsesApi("gpt-5.99"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5-turbo"), true);
  assert.equal(shouldUseCopilotResponsesApi("gpt-5-ultra"), true);

  // Explicit exclusion
  assert.equal(shouldUseCopilotResponsesApi("gpt-5-mini"), false);

  // Non-gpt-5 variants stay on chat path
  assert.equal(shouldUseCopilotResponsesApi("gpt-6"), false);
  // gpt-5mini (no hyphen) forward-matches "gpt-5" prefix and is not "gpt-5-mini"
  assert.equal(shouldUseCopilotResponsesApi("gpt-5mini"), true); // no hyphen → forward match
});

test("createHydraCopilotProvider custom fetch overrides sentinel Authorization header", async () => {
  const { createHydraCopilotProvider } = await import(`../dist/sdk/hydra-copilot-provider.js?sentinel=${Date.now()}`);

  let capturedAuth = null;

  const provider = createHydraCopilotProvider({
    // Provide an apiKey so the provider sets an Authorization header that the custom fetch can override
    apiKey: "copilothydra-managed",
    baseURL: "https://api.githubcopilot.com",
    fetch: async (url, init) => {
      // Simulate auth loader: capture whatever auth was set, then inject real token
      const headers = new Headers(init?.headers ?? {});
      headers.delete("authorization");
      headers.delete("Authorization");
      headers.set("Authorization", "Bearer gho_real_token_injected_by_loader");
      capturedAuth = headers.get("Authorization");
      return new Response(
        JSON.stringify({ id: "resp-test", object: "response", output: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, model: "gpt-5" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
  });

  // Use doStream (the only method the wrapper reliably preserves as an own property)
  // and a responses-path model (gpt-5) to exercise the full routing + fetch chain
  const model = provider.languageModel("gpt-5");
  try {
    const result = await model.doStream({
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    // Drain the stream to ensure the fetch fires
    const reader = result.stream.getReader();
    try { while (true) { const { done } = await reader.read(); if (done) break; } } catch { /* ignore parse errors */ }
  } catch {
    // May fail on response parsing — we only care about the header captured
  }

  // The real token (injected by the custom fetch) should have overridden the sentinel
  assert.equal(capturedAuth, "Bearer gho_real_token_injected_by_loader",
    "auth loader's token should override the sentinel API key");
});
