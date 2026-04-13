const KEYRING_VERSION = "1.2.0";

function warn(message) {
  process.stderr.write(`[copilothydra] ${message}\n`);
}

if (process.platform !== "darwin") {
  process.exit(0);
}

const expectedPackage =
  process.arch === "arm64"
    ? "@napi-rs/keyring-darwin-arm64"
    : process.arch === "x64"
      ? "@napi-rs/keyring-darwin-x64"
      : null;

if (!expectedPackage) {
  warn(`macOS keychain check skipped: unsupported architecture ${process.arch}`);
  process.exit(0);
}

try {
  await import("@napi-rs/keyring");
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  warn(
    `macOS keychain support is unavailable: ${reason}` +
      `\n[copilothydra] Expected optional dependency: ${expectedPackage}@${KEYRING_VERSION}` +
      `\n[copilothydra] Reinstall without omitting optional dependencies, then rerun auth or 'copilothydra backfill-keychain'.`,
  );
}
