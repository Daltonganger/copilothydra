/**
 * CopilotHydra — logging helpers
 *
 * Minimal structured logging. Output goes to stderr to avoid interfering with
 * any stdout protocol between plugin and host.
 *
 * Rules:
 * - Token values must NEVER be passed to any log function.
 * - Debug output is gated on flags from src/flags.ts.
 * - All public functions accept `unknown` so callers don't need to cast.
 */

import { DEBUG, DEBUG_AUTH, DEBUG_ROUTING, DEBUG_STORAGE } from "./flags.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: string, scope: string, message: string, data?: unknown): void {
  const parts: string[] = [`[${timestamp()}]`, `[copilothydra]`, `[${level}]`];
  if (scope) parts.push(`[${scope}]`);
  parts.push(message);
  if (data !== undefined) {
    parts.push(JSON.stringify(data));
  }
  process.stderr.write(parts.join(" ") + "\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Always-on: log a warning. */
export function warn(scope: string, message: string, data?: unknown): void {
  write("WARN", scope, message, data);
}

/** Always-on: log an error. */
export function error(scope: string, message: string, data?: unknown): void {
  write("ERROR", scope, message, data);
}

/** Always-on: log an info message. */
export function info(scope: string, message: string, data?: unknown): void {
  write("INFO", scope, message, data);
}

/** Gated on DEBUG flag. */
export function debug(scope: string, message: string, data?: unknown): void {
  if (DEBUG) write("DEBUG", scope, message, data);
}

/** Gated on DEBUG_AUTH flag. */
export function debugAuth(message: string, data?: unknown): void {
  if (DEBUG_AUTH) write("DEBUG", "auth", message, data);
}

/** Gated on DEBUG_ROUTING flag. */
export function debugRouting(message: string, data?: unknown): void {
  if (DEBUG_ROUTING) write("DEBUG", "routing", message, data);
}

/** Gated on DEBUG_STORAGE flag. */
export function debugStorage(message: string, data?: unknown): void {
  if (DEBUG_STORAGE) write("DEBUG", "storage", message, data);
}
