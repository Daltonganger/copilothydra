/**
 * CopilotHydra — OpenCode version / compatibility check
 *
 * This module detects the running OpenCode version and warns or errors
 * when assumptions about internal behavior may be violated.
 *
 * Policy (from PLAN.md):
 * - warn-first on unknown versions
 * - fail closed only when runtime assumptions are demonstrably broken
 * - never hard-block on unknown version alone
 *
 * NOTE: This is a scaffold/stub. Real version detection logic is deferred
 * to Spike A, where we confirm what PluginInput exposes.
 */

import { warn, info } from "../log.js";
import { SKIP_VERSION_CHECK } from "../flags.js";

// ---------------------------------------------------------------------------
// Known-good version ranges
// ---------------------------------------------------------------------------

/**
 * OpenCode versions we have explicitly tested against.
 * Keep this sorted ascending.
 */
const KNOWN_GOOD_VERSIONS: string[] = [
  // populated after Spike A / Spike B testing
];

// ---------------------------------------------------------------------------
// Compatibility check
// ---------------------------------------------------------------------------

export interface CompatibilityResult {
  ok: boolean;
  version: string | null;
  warnings: string[];
}

/**
 * Run compatibility checks against the detected OpenCode version.
 *
 * Called once at plugin startup (from src/index.ts).
 * Returns warnings to surface to the user; does not throw.
 *
 * @param pluginInput - The raw plugin input object from OpenCode
 */
export function checkCompatibility(pluginInput: unknown): CompatibilityResult {
  if (SKIP_VERSION_CHECK) {
    info("compat", "Version check skipped (COPILOTHYDRA_SKIP_VERSION_CHECK=1)");
    return { ok: true, version: null, warnings: [] };
  }

  const warnings: string[] = [];

  // TODO (Spike A): extract version from pluginInput once we know its shape
  const version = detectVersion(pluginInput);

  if (version === null) {
    warnings.push(
      "Could not detect OpenCode version. CopilotHydra may behave incorrectly. " +
      "Set COPILOTHYDRA_SKIP_VERSION_CHECK=1 to suppress this warning during development."
    );
    warn("compat", "OpenCode version could not be detected", { inputKeys: typeof pluginInput === "object" && pluginInput !== null ? Object.keys(pluginInput) : "not-an-object" });
  } else if (!KNOWN_GOOD_VERSIONS.includes(version)) {
    warnings.push(
      `OpenCode version "${version}" is not in the tested-version matrix for CopilotHydra. ` +
      "Proceed with caution. See docs/compatibility-matrix.md."
    );
    warn("compat", `Untested OpenCode version: ${version}`);
  } else {
    info("compat", `OpenCode version "${version}" is in the tested-version matrix.`);
  }

  return {
    ok: true, // warn-first policy: unknown version alone is not a hard failure
    version,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Internal: version detection
// ---------------------------------------------------------------------------

/**
 * Attempt to extract the OpenCode version from the plugin input.
 *
 * TODO (Spike A): determine what PluginInput actually exposes.
 * For now this is always null (no crash, no false positives).
 */
function detectVersion(_pluginInput: unknown): string | null {
  // Stub: real implementation after Spike A
  return null;
}
