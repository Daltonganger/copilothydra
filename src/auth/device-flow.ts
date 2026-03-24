/**
 * CopilotHydra — GitHub device flow
 *
 * Implements the GitHub OAuth device authorization flow.
 * Used to obtain a GitHub OAuth token for a new Copilot account.
 *
 * Flow:
 * 1. POST /login/device/code  → device_code, user_code, verification_uri
 * 2. Display verification_uri + user_code to user
 * 3. Poll /login/oauth/access_token until authorized or expired
 * 4. Return access_token (used directly as Copilot Bearer token)
 *
 * References:
 * - OpenCode's CopilotAuthPlugin (src/plugin/copilot.ts in sst/opencode)
 * - https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 *
 * NOTE: This is a Phase 0 scaffold. Real TUI integration (displaying
 * user_code, opening browser) is implemented in Phase 5.
 */

import { info, warn, debugAuth } from "../log.js";
import { GITHUB_CLIENT_ID } from "./loader.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface DeviceFlowResult {
  /** The GitHub OAuth access token (used as Copilot Bearer token) */
  accessToken: string;
  /** Scopes granted */
  scope: string;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DeviceFlowError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

// ---------------------------------------------------------------------------
// Step 1: request device code
// ---------------------------------------------------------------------------

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  debugAuth("requesting device code from GitHub");

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!response.ok) {
    throw new DeviceFlowError(
      `GitHub device code request failed: ${response.status} ${response.statusText}`,
      "request_failed"
    );
  }

  const data = (await response.json()) as DeviceCodeResponse;
  debugAuth("device code received", { verification_uri: data.verification_uri });
  return data;
}

// ---------------------------------------------------------------------------
// Step 2: poll for access token
// ---------------------------------------------------------------------------

/**
 * Poll GitHub until the user authorizes the device or the code expires.
 *
 * @param deviceCode - The device_code from requestDeviceCode
 * @param interval   - Polling interval in seconds (from requestDeviceCode)
 * @param expiresIn  - How long the device code is valid, in seconds
 */
export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<DeviceFlowResult> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  info("auth", "Waiting for GitHub authorization...");

  while (Date.now() < deadline) {
    await sleep(pollInterval);
    debugAuth("polling GitHub for access token");

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!response.ok) {
      warn("auth", `Poll request failed: ${response.status} ${response.statusText}`);
      continue;
    }

    const data = (await response.json()) as Record<string, string>;

    if (data["error"]) {
      switch (data["error"]) {
        case "authorization_pending":
          // User hasn't authorized yet — keep polling
          debugAuth("authorization_pending, continuing to poll");
          break;
        case "slow_down":
          // GitHub asked us to slow down
          pollInterval += 5000;
          debugAuth(`slow_down received, new interval: ${pollInterval}ms`);
          break;
        case "expired_token":
          throw new DeviceFlowError(
            "Device code expired before authorization was granted.",
            "expired_token"
          );
        case "access_denied":
          throw new DeviceFlowError(
            "User denied authorization.",
            "access_denied"
          );
        default:
          throw new DeviceFlowError(
            `Unexpected error during device flow polling: ${data["error"]}`,
            data["error"] ?? "unknown"
          );
      }
      continue;
    }

    if (data["access_token"]) {
      debugAuth("access token received");
      return {
        accessToken: data["access_token"],
        scope: data["scope"] ?? "",
      };
    }
  }

  throw new DeviceFlowError(
    "Device flow timed out waiting for authorization.",
    "timeout"
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
