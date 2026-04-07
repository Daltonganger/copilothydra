/**
 * CopilotHydra — shared OpenCode auth.json path resolution
 *
 * Centralises the path-resolution logic that was previously duplicated across
 * opencode-auth-sync.ts, storage-audit.ts, usage-snapshot.ts, and
 * primary-compat-export.ts.
 *
 * Resolution order (matches OpenCode behaviour):
 * 1. COPILOTHYDRA_TEST_AUTH_PATH  (test override, highest priority)
 * 2. XDG_DATA_HOME/opencode/auth.json  (Linux / XDG convention)
 * 3. Platform-specific default:
 *    - macOS:  ~/.local/share/opencode/auth.json
 *    - Windows: %APPDATA%/opencode/auth.json
 *    - other:   ~/.local/share/opencode/auth.json
 *
 * The HOME directory is resolved from:
 *   OPENCODE_TEST_HOME > HOME > USERPROFILE > "~"
 */

import { join } from "node:path";

/**
 * Resolve the canonical path to OpenCode's auth.json.
 *
 * Exported so that every module that needs to locate auth.json goes through
 * the same logic. All previous per-module copies of this resolver are
 * replaced by calls to this function.
 */
export function resolveOpenCodeAuthPath(): string {
	if (process.env["COPILOTHYDRA_TEST_AUTH_PATH"]) {
		return process.env["COPILOTHYDRA_TEST_AUTH_PATH"];
	}

	const home =
		process.env["OPENCODE_TEST_HOME"] ??
		process.env["HOME"] ??
		process.env["USERPROFILE"] ??
		"~";

	if (process.env["XDG_DATA_HOME"]) {
		return join(process.env["XDG_DATA_HOME"], "opencode", "auth.json");
	}

	if (process.platform === "win32") {
		const appData =
			process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
		return join(appData, "opencode", "auth.json");
	}

	return join(home, ".local", "share", "opencode", "auth.json");
}

/**
 * Return additional candidate auth.json paths to probe when recovering tokens.
 *
 * The primary resolveOpenCodeAuthPath() returns exactly one path (the one we
 * write to). Some users may have tokens at alternate locations; this function
 * returns those so the caller can probe all of them.
 */
export function candidateOpenCodeAuthPaths(): string[] {
	const home =
		process.env["OPENCODE_TEST_HOME"] ??
		process.env["HOME"] ??
		process.env["USERPROFILE"] ??
		"~";

	const paths: string[] = [];

	// XDG path
	if (process.env["XDG_DATA_HOME"]) {
		paths.push(join(process.env["XDG_DATA_HOME"], "opencode", "auth.json"));
	}

	// POSIX / macOS default
	paths.push(join(home, ".local", "share", "opencode", "auth.json"));

	// macOS Application Support (some OpenCode builds used this)
	if (process.platform === "darwin") {
		paths.push(
			join(home, "Library", "Application Support", "opencode", "auth.json"),
		);
	}

	// Windows AppData
	if (process.platform === "win32") {
		const appData =
			process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
		paths.push(join(appData, "opencode", "auth.json"));
	}

	// Deduplicate while preserving order
	return [...new Set(paths)];
}
