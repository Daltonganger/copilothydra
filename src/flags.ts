/**
 * CopilotHydra — debug flags and feature flags
 *
 * All runtime flags are read from environment variables at startup.
 * This module is the single authoritative source for flag state.
 *
 * Debug flags are intentionally additive and never change behavior
 * in a breaking way — they only produce extra output.
 */

// ---------------------------------------------------------------------------
// Debug flags (opt-in via env vars)
// ---------------------------------------------------------------------------

/**
 * COPILOTHYDRA_DEBUG=1
 * Master switch for all debug output.
 * When false, all debug log calls are no-ops.
 */
export const DEBUG = process.env["COPILOTHYDRA_DEBUG"] === "1";

/**
 * COPILOTHYDRA_DEBUG_AUTH=1
 * Enables auth-specific debug output (loader calls, token resolution, etc).
 * Token values are never logged even with this flag set.
 */
export const DEBUG_AUTH = DEBUG || process.env["COPILOTHYDRA_DEBUG_AUTH"] === "1";

/**
 * COPILOTHYDRA_DEBUG_ROUTING=1
 * Enables provider → account resolution debug output.
 */
export const DEBUG_ROUTING = DEBUG || process.env["COPILOTHYDRA_DEBUG_ROUTING"] === "1";

/**
 * COPILOTHYDRA_DEBUG_STORAGE=1
 * Enables storage read/write debug output.
 * Secret values are never logged even with this flag set.
 */
export const DEBUG_STORAGE = DEBUG || process.env["COPILOTHYDRA_DEBUG_STORAGE"] === "1";

// ---------------------------------------------------------------------------
// Feature flags (used during development / feasibility phases)
// ---------------------------------------------------------------------------

/**
 * COPILOTHYDRA_SKIP_VERSION_CHECK=1
 * Skips the OpenCode version compatibility check.
 * Use only during development. In production, compatibility warnings still fire.
 */
export const SKIP_VERSION_CHECK =
  process.env["COPILOTHYDRA_SKIP_VERSION_CHECK"] === "1";


