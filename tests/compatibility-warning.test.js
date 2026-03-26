import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runCheckCompatibility(pluginInput) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { checkCompatibility } = await import('./dist/auth/compatibility-check.js');
       const pluginInput = JSON.parse(process.env.TEST_PLUGIN_INPUT ?? 'null');
       const result = checkCompatibility(pluginInput);
       process.stdout.write(JSON.stringify(result));`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_PLUGIN_INPUT: JSON.stringify(pluginInput),
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("compatibility check stays quiet when version cannot be detected", () => {
  const payload = runCheckCompatibility({ client: {}, directory: ".", serverUrl: "x" });
  assert.equal(payload.ok, true);
  assert.equal(payload.version, null);
  assert.equal(payload.warnings.length, 0);
});

test("compatibility check detects tested versions from host-exposed client signals", () => {
  const payload = runCheckCompatibility({
    client: { version: "OpenCode v1.3.3" },
    directory: ".",
    serverUrl: "http://localhost:4096",
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.version, "1.3.3");
  assert.deepEqual(payload.warnings, []);
});

test("compatibility check warns on untested detected versions", () => {
  const payload = runCheckCompatibility({
    client: { opencodeVersion: "0.5.0-beta.1" },
    directory: ".",
    serverUrl: "http://localhost:4096",
  });

  assert.equal(payload.version, "0.5.0-beta.1");
  assert.match(payload.warnings[0], /not in the tested-version matrix/);
});

test("compatibility check warns when required host hook signals are missing", () => {
  const payload = runCheckCompatibility({ client: { version: "1.3.3" } });

  assert.equal(payload.version, "1.3.3");
  assert.equal(payload.warnings.length, 2);
  assert.match(payload.warnings[0], /missing a usable directory string/);
  assert.match(payload.warnings[1], /missing a usable serverUrl string/);
});
