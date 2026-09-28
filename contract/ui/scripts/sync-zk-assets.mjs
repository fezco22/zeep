import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractDir = resolve(uiDir, "..");
const artifacts = [
  { version: "v2", sourceDir: resolve(contractDir, "v2", "managed", "zeep"), targetDir: resolve(uiDir, "public", "zk", "zeep"), inputs: 8 },
  { version: "v3", sourceDir: resolve(contractDir, "managed", "zeep"), targetDir: resolve(uiDir, "public", "zk", "zeep-v3"), inputs: 6 },
];

const files = [
  ["keys/register.prover", "keys/register.prover"],
  ["keys/register.verifier", "keys/register.verifier"],
  ["zkir/register.bzkir", "zkir/register.bzkir"],
  ["zkir/register.zkir", "zkir/register.zkir"],
];

for (const artifact of artifacts) {
  const zkir = JSON.parse(await readFile(resolve(artifact.sourceDir, "zkir/register.zkir"), "utf8"));
  if (zkir.num_inputs !== artifact.inputs) {
    throw new Error(`${artifact.version} register.zkir schema mismatch: expected ${artifact.inputs} inputs, received ${zkir.num_inputs}`);
  }
  for (const [source, target] of files) {
    const destination = resolve(artifact.targetDir, target);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(artifact.sourceDir, source), destination);
  }
  console.log(`Synced ${artifact.version} register proving assets`);
}
