/**
 * CopilotHydra — OpenCode config file helpers
 *
 * Phase 1 utility for writing provider entries into the user's OpenCode config.
 *
 * Important constraints confirmed by Spike C / Spike E:
 * - Plugins cannot mutate config via `Hooks.config`; it is read-only.
 * - Therefore provider entries must be written to opencode.json / opencode.jsonc.
 * - Config path resolution must honor OPENCODE_CONFIG and OPENCODE_CONFIG_DIR.
 * - We use a stricter write path than OpenCode itself: file lock + temp write + rename.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CopilotAccountMeta, ProviderId } from "../types.js";
import { debugStorage } from "../log.js";
import { withLock } from "../storage/locking.js";
import { resolveConfigDir } from "../storage/accounts.js";
import { buildProviderConfig, type ProviderConfigEntry } from "./providers.js";

export interface OpenCodeConfigFile {
  disabled_providers?: string[];
  provider?: Record<string, ProviderConfigEntry>;
  plugin?: string[];
  [key: string]: unknown;
}

export interface CopilotHydraOpenCodeState {
  managedDisabledProviders?: string[];
  managedPrimaryCompatibility?: {
    accountId: string;
    opencodeAuthAlias?: boolean;
    ghHostsEntry?: boolean;
  };
}

export function resolveOpenCodeConfigPath(configDir?: string): string {
  if (process.env["OPENCODE_CONFIG"]) {
    return process.env["OPENCODE_CONFIG"];
  }

  const dir = configDir ?? resolveConfigDir();
  const jsonPath = join(dir, "opencode.json");
  const jsoncPath = join(dir, "opencode.jsonc");

  return fileExistsSyncLike(jsoncPath) ? jsoncPath : jsonPath;
}

export function resolveCopilotHydraOpenCodeStatePath(configDir?: string): string {
  const dir = configDir ?? resolveConfigDir();
  return join(dir, "copilothydra-opencode-state.json");
}

export async function loadOpenCodeConfig(configPath?: string): Promise<OpenCodeConfigFile> {
  const path = configPath ?? resolveOpenCodeConfigPath();

  try {
    const raw = await readFile(path, "utf-8");
    const normalized = stripJsonCommentsAndTrailingCommas(raw);
    const parsed = JSON.parse(normalized) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("OpenCode config root must be an object");
    }
    return parsed as OpenCodeConfigFile;
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return {};
    }
    throw new Error(`[copilothydra] Failed to load OpenCode config: ${String(err)}`);
  }
}

export async function loadCopilotHydraOpenCodeState(
  statePath?: string,
): Promise<CopilotHydraOpenCodeState> {
  const path = statePath ?? resolveCopilotHydraOpenCodeStatePath();

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("CopilotHydra OpenCode state root must be an object");
    }
    return parsed as CopilotHydraOpenCodeState;
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return {};
    }
    throw new Error(`[copilothydra] Failed to load CopilotHydra OpenCode state: ${String(err)}`);
  }
}

export async function saveOpenCodeConfig(
  config: OpenCodeConfigFile,
  configPath?: string
): Promise<void> {
  const path = configPath ?? resolveOpenCodeConfigPath();
  const tmpPath = path + ".tmp";
  const json = JSON.stringify(config, null, 2) + "\n";

  await mkdir(dirname(path), { recursive: true });

  await withLock(path, async () => {
    await writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });

    if (process.platform === "win32") {
      try {
        try {
          await unlink(path);
        } catch {
          // ignore
        }
        await rename(tmpPath, path);
      } catch {
        await writeFile(path, json, { encoding: "utf-8", mode: 0o600 });
      }
      return;
    }

    await rename(tmpPath, path);
  });
}

export async function saveCopilotHydraOpenCodeState(
  state: CopilotHydraOpenCodeState,
  statePath?: string,
): Promise<void> {
  const path = statePath ?? resolveCopilotHydraOpenCodeStatePath();
  const tmpPath = path + ".tmp";
  const json = JSON.stringify(state, null, 2) + "\n";

  await mkdir(dirname(path), { recursive: true });

  await withLock(path, async () => {
    await writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });

    if (process.platform === "win32") {
      try {
        try {
          await unlink(path);
        } catch {
          // ignore
        }
        await rename(tmpPath, path);
      } catch {
        await writeFile(path, json, { encoding: "utf-8", mode: 0o600 });
      }
      return;
    }

    await rename(tmpPath, path);
  });
}

export async function upsertProviderConfigInOpenCode(
  account: CopilotAccountMeta,
  configPath?: string
): Promise<void> {
  const path = configPath ?? resolveOpenCodeConfigPath();

  await withLock(path, async () => {
    const config = await loadOpenCodeConfig(path);
    const nextProvider = {
      ...(config.provider ?? {}),
      [account.providerId]: buildProviderConfig(account),
    };

    await saveUnlocked(
      {
        ...config,
        provider: nextProvider,
      },
      path
    );
  });
}

export async function removeProviderConfigFromOpenCode(
  providerId: ProviderId,
  configPath?: string
): Promise<void> {
  const path = configPath ?? resolveOpenCodeConfigPath();

  await withLock(path, async () => {
    const config = await loadOpenCodeConfig(path);
    if (!config.provider || !(providerId in config.provider)) return;

    const nextProvider = { ...config.provider };
    delete nextProvider[providerId];

    await saveUnlocked(
      Object.keys(nextProvider).length > 0
        ? {
            ...config,
            provider: nextProvider,
          }
        : omitProvider(config),
      path
    );
  });
}

async function saveUnlocked(config: OpenCodeConfigFile, path: string): Promise<void> {
  const tmpPath = path + ".tmp";
  const json = JSON.stringify(config, null, 2) + "\n";
  debugStorage(`writing OpenCode config: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });

  if (process.platform === "win32") {
    try {
      try {
        await unlink(path);
      } catch {
        // ignore
      }
      await rename(tmpPath, path);
    } catch {
      await writeFile(path, json, { encoding: "utf-8", mode: 0o600 });
    }
    return;
  }

  await rename(tmpPath, path);
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  const withoutComments = stripJsonComments(input);
  return stripTrailingCommas(withoutComments);
}

function stripJsonComments(input: string): string {
  let result = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaping = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    result += char;
  }

  return result;
}

function stripTrailingCommas(input: string): string {
  let result = "";
  let inString = false;
  let escaping = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      result += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === ",") {
      let j = i + 1;
      while (j < input.length) {
        const candidate = input[j];
        if (candidate === undefined || !/\s/.test(candidate)) break;
        j++;
      }
      const nextNonWhitespace = input[j] ?? "";
      if (nextNonWhitespace === "}" || nextNonWhitespace === "]") {
        continue;
      }
    }

    result += char;
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function fileExistsSyncLike(path: string): boolean {
  return existsSync(path);
}

function omitProvider(config: OpenCodeConfigFile): OpenCodeConfigFile {
  const { provider: _provider, ...rest } = config;
  return rest;
}
