/**
 * CopilotHydra — TUI select (stub)
 *
 * Phase 0 scaffold for generic single/multi-select prompts.
 * Full implementation is Phase 5.
 */

/**
 * Simple select prompt (stub).
 * TODO (Phase 5): implement with readline or ink.
 */
export async function selectOne<T extends { label: string }>(
  _prompt: string,
  _options: T[]
): Promise<T | null> {
  throw new Error("[copilothydra] TUI select is not yet implemented (Phase 5 TODO)");
}

/**
 * Simple confirm prompt (stub).
 * TODO (Phase 5): implement with readline or ink.
 */
export async function confirm(_prompt: string): Promise<boolean> {
  throw new Error("[copilothydra] TUI confirm is not yet implemented (Phase 5 TODO)");
}
