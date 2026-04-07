/**
 * CopilotHydra — local Copilot provider factory
 *
 * Mirrors OpenCode's built-in github-copilot model routing for account-scoped
 * Hydra providers.
 */

import { appendFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { shouldUseCopilotResponsesApi } from "../config/models.js";
import { extractErrorText, stringifyUnknown } from "../error-text.js";

const RESPONSES_SENTINEL_API_KEY = "copilothydra-managed";
const require = createRequire(import.meta.url);

export interface HydraCopilotProviderOptions {
	apiKey?: string;
	baseURL?: string;
	fetch?: typeof globalThis.fetch;
	headers?: Record<string, string>;
	includeUsage?: boolean;
	name?: string;
	/**
	 * Hydra provider ID (e.g. "github-copilot-user-alice" or legacy
	 * "github-copilot-acct-abc123"). Used by the self-auth fallback in the
	 * default export to resolve the matching account/token from Hydra storage
	 * when OpenCode does not pass through fetch/apiKey.
	 */
	providerId?: string;
}

interface HydraCopilotLanguageProvider {
	(modelId: string, settings?: Record<string, unknown>): unknown;
	languageModel: (
		modelId: string,
		settings?: Record<string, unknown>,
	) => unknown;
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

type ModelFactory = (
	modelId: string,
	settings?: Record<string, unknown>,
) => unknown;

interface OpenAIResponsesProviderLike {
	responses: ModelFactory;
}

function withDefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(
			([, entry]) => entry !== undefined && entry !== "",
		),
	) as T;
}

function normalizeModelError(error: unknown): Error {
	void maybeLogHydraModelError(error);
	const message = extractErrorText(error);
	return new Error(
		message.length > 0 ? message : "Unknown Copilot provider error",
	);
}

async function maybeLogHydraModelError(error: unknown): Promise<void> {
	if (process.env.COPILOTHYDRA_DEBUG_BAD_REQUEST !== "1") {
		return;
	}

	await appendFile(
		"/tmp/copilothydra-model-error.log",
		`${stringifyUnknown(error)}\n`,
	);
}

async function maybeLogHydraProviderDebug(payload: unknown): Promise<void> {
	if (process.env.COPILOTHYDRA_DEBUG_BAD_REQUEST !== "1") {
		return;
	}

	await appendFile(
		"/tmp/copilothydra-provider-debug.log",
		`${JSON.stringify(payload)}\n`,
	);
}

export function withHydraCopilotErrorNormalization(model: unknown): unknown {
	if (!model || typeof model !== "object") {
		return model;
	}

	const maybeModel = model as ModelLike;
	const wrapped: ModelLike = { ...maybeModel };

	if (typeof maybeModel.doGenerate === "function") {
		const doGenerate = maybeModel.doGenerate.bind(maybeModel);
		wrapped.doGenerate = async (...args: unknown[]) => {
			try {
				return await doGenerate(...args);
			} catch (error) {
				throw normalizeModelError(error);
			}
		};
	}

	if (typeof maybeModel.doStream === "function") {
		const doStream = maybeModel.doStream.bind(maybeModel);
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

	const maybeStreamModel = model as {
		doStream?: (...args: unknown[]) => Promise<StreamResultLike>;
	};
	if (typeof maybeStreamModel.doStream !== "function") {
		return model;
	}

	const doStream = maybeStreamModel.doStream.bind(maybeStreamModel);

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
				stream: result.stream.pipeThrough(
					new TransformStream<StreamChunk, StreamChunk>({
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
					}),
				),
			};
		},
	};
}

function wrapHydraCopilotModel(model: unknown): unknown {
	return withHydraCopilotErrorNormalization(
		withHydraCopilotResponsesParity(model),
	);
}

export function sanitizeHydraCopilotSettings(
	settings?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (!settings) {
		return undefined;
	}

	const { variant: _ignoredVariant, ...rest } = settings;
	return rest;
}

function createResponsesProvider(
	options: HydraCopilotProviderOptions,
): OpenAIResponsesProviderLike {
	const providerOptions = withDefined({
		apiKey: options.apiKey ?? RESPONSES_SENTINEL_API_KEY,
		baseURL: options.baseURL,
		fetch: options.fetch,
		headers: options.headers,
		name: options.name,
	}) as never;

	try {
		const openAI = require("@ai-sdk/openai") as {
			createOpenAI?: (providerOptions: never) => OpenAIResponsesProviderLike;
		};
		if (typeof openAI.createOpenAI === "function") {
			return openAI.createOpenAI(providerOptions);
		}
	} catch {
		// Fall through to the OpenAI-compatible shim when the local @ai-sdk/openai
		// install is incomplete. This keeps Hydra's Copilot Responses route alive
		// for local/dev environments while still preferring the real SDK when present.
	}

	return {
		responses: createOpenAICompatible(
			providerOptions,
		) as unknown as ModelFactory,
	};
}

export function createHydraCopilotProvider(
	options: HydraCopilotProviderOptions = {},
): HydraCopilotLanguageProvider {
	const chatProvider = createOpenAICompatible(
		withDefined({
			apiKey: options.apiKey,
			baseURL: options.baseURL,
			fetch: options.fetch,
			headers: options.headers,
			includeUsage: options.includeUsage,
			name: options.name,
		}) as never,
	);

	const responsesProvider = createResponsesProvider(options);

	const chatModel = chatProvider as unknown as ModelFactory;
	const responsesModel = responsesProvider.responses as unknown as ModelFactory;

	const languageModel = (
		modelId: string,
		settings?: Record<string, unknown>,
	) => {
		const sanitizedSettings = sanitizeHydraCopilotSettings(settings);
		return shouldUseCopilotResponsesApi(modelId)
			? wrapHydraCopilotModel(responsesModel(modelId, sanitizedSettings))
			: wrapHydraCopilotModel(chatModel(modelId, sanitizedSettings));
	};

	const provider = ((modelId: string, settings?: Record<string, unknown>) =>
		languageModel(modelId, settings)) as HydraCopilotLanguageProvider;

	provider.languageModel = languageModel;
	provider.chat = (modelId: string, settings?: Record<string, unknown>) =>
		wrapHydraCopilotModel(
			chatModel(modelId, sanitizeHydraCopilotSettings(settings)),
		);
	provider.responses = (modelId: string, settings?: Record<string, unknown>) =>
		wrapHydraCopilotModel(
			responsesModel(modelId, sanitizeHydraCopilotSettings(settings)),
		);

	return provider;
}

// ---------------------------------------------------------------------------
// Self-authing default export
// ---------------------------------------------------------------------------

/**
 * Resolve a GitHub OAuth token from Hydra storage for the given providerId.
 *
 * Supports both the primary user-prefix ("github-copilot-user-<username>")
 * and the legacy acct-prefix ("github-copilot-acct-<accountId>").
 */
async function resolveTokenFromStorage(
	providerId: string,
	configDir?: string,
): Promise<string | undefined> {
	try {
		const { loadAccounts } = await import("../storage/accounts.js");
		const { loadSecrets } = await import("../storage/secrets.js");

		const accountsFile = await loadAccounts(configDir);
		const account = accountsFile.accounts.find(
			(a) => a.providerId === providerId,
		);
		if (!account) {
			return undefined;
		}

		const secretsFile = await loadSecrets(configDir);
		const secret = secretsFile.secrets.find((s) => s.accountId === account.id);
		return secret?.githubOAuthToken;
	} catch {
		return undefined;
	}
}

/**
 * Build a self-authing fetch wrapper that injects Authorization Bearer and
 * Openai-Intent headers. Resolves the token lazily from Hydra storage on
 * first use and caches it for the lifetime of the provider instance.
 */
function createSelfAuthingFetch(providerId: string): typeof globalThis.fetch {
	let cachedToken: string | undefined;
	let tokenResolved = false;

	const resolveOnce = async (): Promise<string | undefined> => {
		if (tokenResolved) {
			return cachedToken;
		}
		cachedToken = await resolveTokenFromStorage(providerId);
		tokenResolved = true;
		void maybeLogHydraProviderDebug({
			stage: "resolve-token",
			providerId,
			hasToken: Boolean(cachedToken),
			tokenLength: cachedToken?.length ?? 0,
		});
		return cachedToken;
	};

	const selfAuthingFetch: typeof globalThis.fetch = async (request, init) => {
		const token = await resolveOnce();
		const headers = new Headers(init?.headers);
		if (token) {
			headers.delete("authorization");
			headers.delete("Authorization");
			headers.set("Authorization", `Bearer ${token}`);
			headers.set("Openai-Intent", "conversation-edits");
		}
		return globalThis.fetch(request, { ...init, headers });
	};

	return selfAuthingFetch;
}

/**
 * Default export: OpenCode calls this factory with options from the
 * provider config entry (which now includes `options.providerId`).
 *
 * Self-auth strategy:
 * 1. If `options.fetch` already exists (e.g., OpenCode passed it through
 *    from the auth loader), use it directly — no self-auth needed.
 * 2. Otherwise, if `options.providerId` is set, build a self-authing fetch
 *    that resolves the matching account/token from Hydra storage.
 * 3. Fall back to `createHydraCopilotProvider` with whatever options exist.
 */
function hydraCopilotProviderFactory(
	options: HydraCopilotProviderOptions = {},
): HydraCopilotLanguageProvider {
	void maybeLogHydraProviderDebug({
		stage: "factory",
		providerId: options.providerId,
		hasFetch: Boolean(options.fetch),
		hasApiKey: Boolean(options.apiKey),
		baseURL: options.baseURL,
	});

	// If fetch is already provided, use it directly
	if (options.fetch) {
		return createHydraCopilotProvider(options);
	}

	// Self-auth: build a fetch wrapper that resolves the token from Hydra storage
	const providerId = options.providerId;
	if (providerId) {
		return createHydraCopilotProvider({
			...options,
			apiKey: options.apiKey ?? RESPONSES_SENTINEL_API_KEY,
			baseURL: options.baseURL ?? "https://api.githubcopilot.com",
			fetch: createSelfAuthingFetch(providerId),
		});
	}

	// No providerId, no fetch — fall through with whatever we have
	return createHydraCopilotProvider(options);
}

export default hydraCopilotProviderFactory;
