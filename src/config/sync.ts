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
  loadOpenCodeConfig,
  resolveOpenCodeConfigPath,
  saveOpenCodeConfig,
  type OpenCodeConfigFile,
} from "./opencode-config.js";

export async function syncAccountsToOpenCodeConfig(configPath?: string): Promise<void> {
  const path = configPath ?? resolveOpenCodeConfigPath();
  const [accountsFile, config] = await Promise.all([loadAccounts(), loadOpenCodeConfig(path)]);

  const activeAccounts = accountsFile.accounts.filter((account) => account.lifecycleState === "active");
  const providerEntries = { ...(config.provider ?? {}) };

  for (const providerId of Object.keys(providerEntries)) {
    if (isCopilotHydraProvider(providerId)) {
      delete providerEntries[providerId];
    }
  }

  for (const account of activeAccounts) {
    providerEntries[account.providerId] = buildProviderConfig(account);
  }

  const nextConfig: OpenCodeConfigFile =
    Object.keys(providerEntries).length > 0
      ? { ...config, provider: providerEntries }
      : omitProvider(config);

  debugStorage(
    `syncing ${activeAccounts.length} CopilotHydra account(s) into OpenCode config: ${path}`
  );
  await saveOpenCodeConfig(nextConfig, path);
}

function omitProvider(config: OpenCodeConfigFile): OpenCodeConfigFile {
  const { provider: _provider, ...rest } = config;
  return rest;
}
