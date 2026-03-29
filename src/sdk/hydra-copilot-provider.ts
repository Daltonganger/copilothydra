/**
 * CopilotHydra — local Copilot provider factory
 *
 * Mirrors OpenCode's built-in github-copilot model routing for account-scoped
 * Hydra providers.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractErrorText } from "../error-text.js";
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
  (modelId: string, settings?: Record<string, unknown>): unknown;
  languageModel: (modelId: string, settings?: Record<string, unknown>) => unknown;
  chat: (modelId: string, settings?: Record<string, unknown>) => unknown;
  responses: (modelId: string, settings?: Record<string, unknown>) => unknown;
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

interface ModelLike {
  doGenerate?: (...args: unknown[]) => Promise<unknown>;
  doStream?: (...args: unknown[]) => Promise<StreamResultLike>;
  [key: string]: unknown;
}

type ModelFactory = (modelId: string, settings?: Record<string, unknown>) => unknown;

function withDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  ) as T;
}

function normalizeModelError(error: unknown): Error {
  const message = extractErrorText(error);
  return new Error(message.length > 0 ? message : "Unknown Copilot provider error");
}

export function withHydraCopilotErrorNormalization(model: unknown): unknown {
  if (!model || typeof model !== "object") {
    return model;
  }

  const maybeModel = model as ModelLike;
  const wrapped: ModelLike = { ...maybeModel };

  if (typeof maybeModel.doGenerate === "function") {
    const doGenerate = maybeModel.doGenerate;
    wrapped.doGenerate = async (...args: unknown[]) => {
      try {
        return await doGenerate(...args);
      } catch (error) {
        throw normalizeModelError(error);
      }
    };
  }

  if (typeof maybeModel.doStream === "function") {
    const doStream = maybeModel.doStream;
    wrapped.doStream = async (...args: unknown[]) => {
      try {
        return await doStream(...args);
      } catch (error) {
        throw normalizeModelError(error);
      }
    };
  }

  return wrapped;
}

export function withHydraCopilotResponsesParity(model: unknown): unknown {
  if (!model || typeof model !== "object") {
    return model;
  }

  const maybeStreamModel = model as { doStream?: (...args: unknown[]) => Promise<StreamResultLike> };
  if (typeof maybeStreamModel.doStream !== "function") {
    return model;
  }

  const doStream = maybeStreamModel.doStream;

  return {
    ...maybeStreamModel,
    async doStream(...args: unknown[]) {
      const result = await doStream(...args);
      if (!result?.stream) {
        return result;
      }

      // Built-in Copilot opens text lazily on the first text-delta. If a stream
      // contains no text-delta chunks at all (for example tool-only output), we
      // intentionally forward it without synthesizing empty text boundaries.
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

function wrapHydraCopilotModel(model: unknown): unknown {
  return withHydraCopilotErrorNormalization(withHydraCopilotResponsesParity(model));
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

  const chatModel = chatProvider as unknown as ModelFactory;
  const responsesModel = responsesProvider.responses as unknown as ModelFactory;

  const languageModel = (modelId: string, settings?: Record<string, unknown>) => {
    return shouldUseCopilotResponsesApi(modelId)
      ? wrapHydraCopilotModel(responsesModel(modelId, settings))
      : wrapHydraCopilotModel(chatModel(modelId, settings));
  };

  const provider = ((modelId: string, settings?: Record<string, unknown>) =>
    languageModel(modelId, settings)) as HydraCopilotLanguageProvider;

  provider.languageModel = languageModel;
  provider.chat = (modelId: string, settings?: Record<string, unknown>) =>
    wrapHydraCopilotModel(chatModel(modelId, settings));
  provider.responses = (modelId: string, settings?: Record<string, unknown>) =>
    wrapHydraCopilotModel(responsesModel(modelId, settings));

  return provider;
}
