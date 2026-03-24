import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("compatibility check warns when version cannot be detected", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { checkCompatibility } = await import('./dist/auth/compatibility-check.js');
       const result = checkCompatibility({ client: {}, directory: '.', serverUrl: 'x' });
       process.stdout.write(JSON.stringify(result));`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.version, null);
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /Could not detect OpenCode version/i);
});
