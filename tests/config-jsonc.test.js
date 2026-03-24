import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cleanupDir, makeTempDir } from "./helpers.js";

test("OpenCode config loader parses jsonc comments and trailing commas", async () => {
  const tempDir = await makeTempDir();
  const configPath = path.join(tempDir, "opencode.jsonc");

  try {
    await fs.writeFile(
      configPath,
      `{
        // comment
        "plugin": [
          "copilothydra",
        ],
        "provider": {
          "github-copilot-acct-test": {
            "name": "Test",
          },
        },
      }\n`,
      "utf8"
    );

    const { loadOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const loaded = await loadOpenCodeConfig(configPath);

    assert.deepEqual(loaded.plugin, ["copilothydra"]);
    assert.equal(loaded.provider["github-copilot-acct-test"].name, "Test");
  } finally {
    await cleanupDir(tempDir);
  }
});
