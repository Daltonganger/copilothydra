/**
 * CopilotHydra — local Copilot provider factory
 *
 * Mirrors OpenCode's built-in github-copilot model routing for account-scoped
 * Hydra providers.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { shouldUseCopilotResponsesApi } from "../config/models.js";

const RESPONSES_SENTINEL_API_KEY = "copilothydra-managed";

export interface HydraCopilotProviderOptions {
  apiKey?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
  includeUsage?: boolean;
  name?: string;
}

interface HydraCopilotLanguageProvider {
  (modelId: string): unknown;
  languageModel: (modelId: string) => unknown;
  chat: (modelId: string) => unknown;
  responses: (modelId: string) => unknown;
}

interface StreamChunk {
  type?: string;
  id?: string;
  [key: string]: unknown;
}

interface StreamResultLike {
  stream: ReadableStream<StreamChunk>;
  [key: string]: unknown;
}

function withDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as T;
}

export function withHydraCopilotResponsesParity(model: unknown): unknown {
  if (!model || typeof model !== "object") {
    return model;
  }

  const maybeStreamModel = model as { doStream?: (...args: unknown[]) => Promise<StreamResultLike> };
  if (typeof maybeStreamModel.doStream !== "function") {
    return model;
  }

  return {
    ...maybeStreamModel,
    async doStream(...args: unknown[]) {
      const result = await maybeStreamModel.doStream?.(...args);
      if (!result?.stream) {
        return result;
      }

      let currentTextId: string | null = null;
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream<StreamChunk, StreamChunk>({
          transform(chunk, controller) {
            if (chunk.type === "text-start") {
              return;
            }

            if (chunk.type === "text-end") {
              return;
            }

            if (chunk.type === "text-delta" && typeof chunk.id === "string") {
              if (currentTextId === null) {
                currentTextId = chunk.id;
                controller.enqueue({ type: "text-start", id: currentTextId });
              }

              controller.enqueue({
                ...chunk,
                id: currentTextId,
              });
              return;
            }

            controller.enqueue(chunk);
          },
          flush(controller) {
            if (currentTextId !== null) {
              controller.enqueue({ type: "text-end", id: currentTextId });
            }
          },
        })),
      };
    },
  };
}

export function createHydraCopilotProvider(
  options: HydraCopilotProviderOptions = {},
): HydraCopilotLanguageProvider {
  const chatProvider = createOpenAICompatible(withDefined({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: options.fetch,
    headers: options.headers,
    includeUsage: options.includeUsage,
    name: options.name,
  }) as never);

  const responsesProvider = createOpenAI(withDefined({
    apiKey: options.apiKey ?? RESPONSES_SENTINEL_API_KEY,
    baseURL: options.baseURL,
    fetch: options.fetch,
    headers: options.headers,
    name: options.name,
  }) as never);

  const languageModel = (modelId: string) => {
    return shouldUseCopilotResponsesApi(modelId)
      ? withHydraCopilotResponsesParity(responsesProvider.responses(modelId))
      : chatProvider(modelId);
  };

  const provider = ((modelId: string) => languageModel(modelId)) as HydraCopilotLanguageProvider;

  provider.languageModel = languageModel;
  provider.chat = (modelId: string) => chatProvider(modelId);
  provider.responses = (modelId: string) =>
    withHydraCopilotResponsesParity(responsesProvider.responses(modelId));

  return provider;
}
