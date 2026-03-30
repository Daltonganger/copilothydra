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
 * Detection is intentionally defensive: we only inspect host signals already
 * present on the PluginInput object and avoid any network calls or hard host
 * dependencies. Unknown versions remain warn-first.
 */

import { warn, info, debug } from "../log.js";
import { SKIP_VERSION_CHECK } from "../flags.js";

// ---------------------------------------------------------------------------
// Known-good version ranges
// ---------------------------------------------------------------------------

/**
 * OpenCode versions we have explicitly tested against.
 * Keep this sorted ascending.
 */
const KNOWN_GOOD_VERSIONS: string[] = [
  "1.3.0",
  "1.3.2",
  "1.3.3",
];

/**
 * Version prefixes that are known-good for every patch release.
 * If the detected version starts with one of these prefixes, it is treated
 * as tested without needing an exact entry in KNOWN_GOOD_VERSIONS.
 */
const KNOWN_GOOD_PREFIXES: string[] = [
  "1.20.",
];

const VERSION_FIELD_CANDIDATES = [
  "version",
  "opencodeVersion",
  "hostVersion",
  "appVersion",
  "sdkVersion",
] as const;

const VERSION_PATH_CANDIDATES: ReadonlyArray<ReadonlyArray<string>> = [
  ["version"],
  ["opencodeVersion"],
  ["hostVersion"],
  ["client", "version"],
  ["client", "opencodeVersion"],
  ["client", "hostVersion"],
  ["client", "appVersion"],
  ["project", "version"],
  ["project", "opencodeVersion"],
  ["worktree", "version"],
  ["$", "version"],
  ["$", "opencodeVersion"],
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
  const signalWarnings = detectHostSignalWarnings(pluginInput);
  warnings.push(...signalWarnings);

  const version = detectVersion(pluginInput);

  if (version === null) {
    debug("compat", "OpenCode version signal not available; skipping compatibility warning", {
      inputKeys:
        typeof pluginInput === "object" && pluginInput !== null
          ? Object.keys(pluginInput)
          : "not-an-object",
    });
  } else if (
    !KNOWN_GOOD_VERSIONS.includes(version) &&
    !KNOWN_GOOD_PREFIXES.some((prefix) => version.startsWith(prefix))
  ) {
    warnings.push(
      `OpenCode version "${version}" is not in the tested-version matrix for CopilotHydra. ` +
      "Proceed with caution. See docs/compatibility-matrix.md."
    );
    warn("compat", `Untested OpenCode version: ${version}`);
  } else {
    info("compat", `OpenCode version "${version}" is in the tested-version matrix.`);
  }

  for (const warningMessage of signalWarnings) {
    warn("compat", warningMessage);
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
 */
function detectVersion(pluginInput: unknown): string | null {
  for (const path of VERSION_PATH_CANDIDATES) {
    const value = readPath(pluginInput, path);
    const version = normalizeVersionCandidate(value);
    if (version !== null) {
      return version;
    }
  }

  const objectsToInspect = collectInspectableObjects(pluginInput);
  for (const value of objectsToInspect) {
    if (!isRecord(value)) {
      continue;
    }
    for (const key of VERSION_FIELD_CANDIDATES) {
      const version = normalizeVersionCandidate(value[key]);
      if (version !== null) {
        return version;
      }
    }
  }

  return null;
}

function detectHostSignalWarnings(pluginInput: unknown): string[] {
  if (!isRecord(pluginInput)) {
    return [
      "OpenCode plugin input is not an object; host compatibility signals are unavailable. See docs/compatibility-matrix.md.",
    ];
  }

  const warnings: string[] = [];

  if (typeof pluginInput.directory !== "string" || pluginInput.directory.length === 0) {
    warnings.push(
      "OpenCode plugin input is missing a usable directory string; host hook shape may have changed. See docs/compatibility-matrix.md."
    );
  }

  if (!hasUsableServerUrl(pluginInput.serverUrl)) {
    warnings.push(
      "OpenCode plugin input is missing a usable serverUrl string/URL; host hook shape may have changed. See docs/compatibility-matrix.md."
    );
  }

  return warnings;
}

function hasUsableServerUrl(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0;
  }

  return value instanceof URL && value.href.length > 0;
}

function collectInspectableObjects(pluginInput: unknown): unknown[] {
  if (!isRecord(pluginInput)) {
    return [];
  }

  return [
    pluginInput,
    pluginInput.client,
    pluginInput.project,
    pluginInput.worktree,
    pluginInput.$,
  ];
}

function readPath(value: unknown, path: ReadonlyArray<string>): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function normalizeVersionCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = trimmed.match(/(?:^|[^\d])v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:$|[^\d])/);
  if (match?.[1]) {
    return match[1];
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
