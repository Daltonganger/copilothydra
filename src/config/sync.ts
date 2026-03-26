/**
 * CopilotHydra — OpenCode provider config sync
 *
 * Reconciles CopilotHydra-managed provider entries in the user's OpenCode config
 * with the current accounts metadata file.
 *
 * Phase 1 use case:
 * - single-account reference flow can write exactly one provider entry
 * - later phases can reuse the same sync logic for multiple accounts
 */

import { loadAccounts } from "../storage/accounts.js";
import { debugStorage } from "../log.js";
import { isCopilotHydraProvider, buildProviderConfig } from "./providers.js";
import {
  loadCopilotHydraOpenCodeState,
  loadOpenCodeConfig,
  resolveCopilotHydraOpenCodeStatePath,
  resolveOpenCodeConfigPath,
  saveCopilotHydraOpenCodeState,
  saveOpenCodeConfig,
  type OpenCodeConfigFile,
} from "./opencode-config.js";

const BUILTIN_COPILOT_PROVIDER_ID = "github-copilot";

export async function syncAccountsToOpenCodeConfig(configPath?: string, configDir?: string): Promise<void> {
  const path = configPath ?? resolveOpenCodeConfigPath();
  const statePath = resolveCopilotHydraOpenCodeStatePath(configDir);
  const [accountsFile, config, managedState] = await Promise.all([
    loadAccounts(configDir),
    loadOpenCodeConfig(path),
    loadCopilotHydraOpenCodeState(statePath),
  ]);
  const { copilothydra: legacyManagedState, ...hostCompatibleConfig } = config as OpenCodeConfigFile & {
    copilothydra?: { managedDisabledProviders?: string[] };
  };

  const activeAccounts = accountsFile.accounts.filter((account) => account.lifecycleState === "active");
  const providerEntries = { ...(hostCompatibleConfig.provider ?? {}) };

  for (const providerId of Object.keys(providerEntries)) {
    if (isCopilotHydraProvider(providerId)) {
      delete providerEntries[providerId];
    }
  }

  for (const account of activeAccounts) {
    providerEntries[account.providerId] = buildProviderConfig(account);
  }

  const { config: configWithManagedDisable, state: nextManagedState } =
    reconcileBuiltInCopilotDisable(
      hostCompatibleConfig,
      mergeManagedDisableState(managedState, legacyManagedState),
      activeAccounts.length > 0,
    );

  const nextConfig: OpenCodeConfigFile =
    Object.keys(providerEntries).length > 0
      ? { ...configWithManagedDisable, provider: providerEntries }
      : omitProvider(configWithManagedDisable);

  debugStorage(
    `syncing ${activeAccounts.length} CopilotHydra account(s) into OpenCode config: ${path}`
  );
  await Promise.all([
    saveOpenCodeConfig(nextConfig, path),
    saveCopilotHydraOpenCodeState(nextManagedState, statePath),
  ]);
}

function omitProvider(config: OpenCodeConfigFile): OpenCodeConfigFile {
  const { provider: _provider, ...rest } = config;
  return rest;
}

function reconcileBuiltInCopilotDisable(
  config: OpenCodeConfigFile,
  managedState: { managedDisabledProviders?: string[] },
  shouldDisableBuiltInCopilot: boolean,
): { config: OpenCodeConfigFile; state: { managedDisabledProviders?: string[] } } {
  const disabledProviders = [...(config.disabled_providers ?? [])];
  const managedDisabledProviders = new Set(managedState.managedDisabledProviders ?? []);
  const builtInIndex = disabledProviders.indexOf(BUILTIN_COPILOT_PROVIDER_ID);

  if (shouldDisableBuiltInCopilot) {
    if (builtInIndex === -1) {
      disabledProviders.push(BUILTIN_COPILOT_PROVIDER_ID);
      managedDisabledProviders.add(BUILTIN_COPILOT_PROVIDER_ID);
    }

    return {
      config: {
        ...config,
        disabled_providers: disabledProviders,
      },
      state: { managedDisabledProviders: [...managedDisabledProviders] },
    };
  }

  if (managedDisabledProviders.has(BUILTIN_COPILOT_PROVIDER_ID)) {
    managedDisabledProviders.delete(BUILTIN_COPILOT_PROVIDER_ID);
    if (builtInIndex !== -1) {
      disabledProviders.splice(builtInIndex, 1);
    }
  }

  const nextConfig: OpenCodeConfigFile = { ...config };

  if (disabledProviders.length > 0) {
    nextConfig.disabled_providers = disabledProviders;
  } else {
    delete nextConfig.disabled_providers;
  }

  return {
    config: nextConfig,
    state:
      managedDisabledProviders.size > 0
        ? { managedDisabledProviders: [...managedDisabledProviders] }
        : {},
  };
}

function mergeManagedDisableState(
  managedState: { managedDisabledProviders?: string[] },
  legacyManagedState: { managedDisabledProviders?: string[] } | undefined,
): { managedDisabledProviders?: string[] } {
  const merged = new Set([
    ...(managedState.managedDisabledProviders ?? []),
    ...(legacyManagedState?.managedDisabledProviders ?? []),
  ]);

  return merged.size > 0 ? { managedDisabledProviders: [...merged] } : {};
}
