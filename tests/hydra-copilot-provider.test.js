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
