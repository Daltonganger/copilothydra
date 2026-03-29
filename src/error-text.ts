/**
 * CopilotHydra — shared error text helpers
 *
 * Normalizes unknown provider/host error payloads into a readable string without
 * assuming a single upstream schema.
 */

function messageFromRecord(record: Record<string, unknown>): string | undefined {
  const directMessage = record["message"];
  if (typeof directMessage === "string" && directMessage.length > 0) {
    return directMessage;
  }

  const body = record["body"];
  if (typeof body === "string" && body.length > 0) {
    return body;
  }
  if (body && typeof body === "object") {
    const nestedBodyMessage = (body as Record<string, unknown>)["message"];
    if (typeof nestedBodyMessage === "string" && nestedBodyMessage.length > 0) {
      return nestedBodyMessage;
    }
  }

  const nestedError = record["error"];
  if (nestedError && typeof nestedError === "object") {
    const nestedErrorMessage = (nestedError as Record<string, unknown>)["message"];
    if (typeof nestedErrorMessage === "string" && nestedErrorMessage.length > 0) {
      return nestedErrorMessage;
    }
  }

  const reason = record["reason"];
  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }
  if (reason && typeof reason === "object") {
    const nestedReasonMessage = (reason as Record<string, unknown>)["message"];
    if (typeof nestedReasonMessage === "string" && nestedReasonMessage.length > 0) {
      return nestedReasonMessage;
    }
  }
  if (reason !== undefined) {
    return stringifyUnknown(reason);
  }

  return undefined;
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function extractErrorText(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "number" || typeof error === "boolean" || error === null) {
    return String(error);
  }

  if (!error || typeof error !== "object") {
    return "";
  }

  return messageFromRecord(error as Record<string, unknown>) ?? stringifyUnknown(error);
}
