import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function makeTempDir(prefix = "copilothydra-test-") {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

export async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
