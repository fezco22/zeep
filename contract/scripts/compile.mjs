import { spawnSync } from "node:child_process";

const [source, output] = process.argv.slice(2);
if (!source || !output) {
  throw new Error("Usage: node scripts/compile.mjs <source.compact> <output-directory>");
}

const result = spawnSync("run-compactc", [source, output], {
  env: { ...process.env, COMPACTC_VERSION: "0.31.1" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
