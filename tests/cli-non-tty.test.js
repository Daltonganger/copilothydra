import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("CLI add-account fails cleanly in non-TTY environments", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "add-account"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal \(TTY\)/i);
});

test("CLI menu fails cleanly in non-TTY environments", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "menu"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal \(TTY\)/i);
});
