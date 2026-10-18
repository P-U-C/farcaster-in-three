#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) {
  process.stdout.write(`${packageJson.version}\n`);
  process.exit(0);
}

const workspace = resolve(process.env.IN_THREE_HOME || process.cwd());
const result = spawnSync("bash", [resolve(packageRoot, "farcaster"), ...args], {
  cwd: workspace,
  env: {
    ...process.env,
    IN_THREE_COMMAND: "in-three",
    IN_THREE_PREBUILT: "1",
    IN_THREE_ROOT: packageRoot,
    IN_THREE_STATE_DIR:
      process.env.IN_THREE_STATE_DIR || resolve(workspace, ".state"),
  },
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`in-three: ${result.error.message}\n`);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
