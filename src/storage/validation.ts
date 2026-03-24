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

export function requireOptionalString(obj: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[copilothydra] ${label} has invalid optional string field: ${key}`);
  }
  return value;
}

export function requireEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
  key: string
): T {
  if (!allowed.includes(value as T)) {
    throw new Error(
      `[copilothydra] ${label} has invalid enum value for ${key}: ${value} (allowed: ${allowed.join(", ")})`
    );
  }
  return value as T;
}

export function requireIsoTimestamp(value: string, label: string, key: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[copilothydra] ${label} has invalid ISO timestamp for ${key}: ${value}`);
  }
  return value;
}
