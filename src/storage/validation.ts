/**
 * CopilotHydra — shared storage validation helpers
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function requireString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[copilothydra] ${label} is missing required string field: ${key}`);
  }
  return value;
}
