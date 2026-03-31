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

import { debugStorage } from "../log.js";
import { loadAccounts } from "../storage/accounts.js";
import { buildProviderConfig, isCopilotHydraProvider } from "./providers.js";
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

  const { config: configWithCleanedBuiltInState, state: nextManagedState } =
    reconcileBuiltInCopilotAvailability(
      hostCompatibleConfig,
      mergeManagedDisableState(managedState, legacyManagedState),
      activeAccounts.length,
    );

  const nextConfig: OpenCodeConfigFile =
    Object.keys(providerEntries).length > 0
      ? { ...configWithCleanedBuiltInState, provider: providerEntries }
      : omitProvider(configWithCleanedBuiltInState);

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

function reconcileBuiltInCopilotAvailability(
  config: OpenCodeConfigFile,
  managedState: { managedDisabledProviders?: string[] },
  activeAccountsCount: number,
): { config: OpenCodeConfigFile; state: { managedDisabledProviders?: string[] } } {
  const disabledProviders = [...(config.disabled_providers ?? [])];
  const managedDisabledProviders = new Set(managedState.managedDisabledProviders ?? []);
  const builtInIndex = disabledProviders.indexOf(BUILTIN_COPILOT_PROVIDER_ID);

  // Step 1: Remove any Hydra-managed disable state first (clean slate).
  // This handles legacy state cleanup and ensures we don't double-add.
  if (managedDisabledProviders.has(BUILTIN_COPILOT_PROVIDER_ID)) {
    managedDisabledProviders.delete(BUILTIN_COPILOT_PROVIDER_ID);
    if (builtInIndex !== -1) {
      disabledProviders.splice(builtInIndex, 1);
    }
  }

  // Step 2: If active Hydra accounts exist, disable the built-in github-copilot
  // provider so its models don't duplicate/overlap with Hydra's account-scoped ones.
  // The Hydra login/add-account entrypoint lives under a distinct provider ID
  // (github-copilot-hydra) so it stays visible even while github-copilot is disabled.
  if (activeAccountsCount > 0) {
    if (!disabledProviders.includes(BUILTIN_COPILOT_PROVIDER_ID)) {
      disabledProviders.push(BUILTIN_COPILOT_PROVIDER_ID);
    }
    managedDisabledProviders.add(BUILTIN_COPILOT_PROVIDER_ID);
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
