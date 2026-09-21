// Persist / restore synced wallet state so a deploy skips the ~1.5M-event dust
// replay from genesis (see the "midnight-headless-dust-replay" note). Each
// sub-wallet exposes serializeState()/restore(); we snapshot all three to one
// JSON file keyed by network + seed hash.
//
// A generic codec encodes Uint8Array as {"__u8":base64} and bigint as
// {"__big":"<dec>"} so whatever shape serializeState() returns round-trips.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type WalletSnapshot = {
  network: string;
  seedHash: string;
  savedAt: string;
  shielded: unknown;
  unshielded: unknown;
  dust: unknown;
};

function encode(value: unknown): unknown {
  if (typeof value === "bigint") return { __big: value.toString() };
  if (value instanceof Uint8Array) return { __u8: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = encode(v);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.__big === "string") return BigInt(o.__big);
    if (typeof o.__u8 === "string") return new Uint8Array(Buffer.from(o.__u8, "base64"));
    if (Array.isArray(value)) return value.map(decode);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = decode(v);
    return out;
  }
  return value;
}

export function snapshotPath(network: string, masterSeedHex: string): string {
  const seedHash = createHash("sha256").update(masterSeedHex).digest("hex").slice(0, 16);
  return resolve(process.cwd(), "deploy", ".wallet-snapshot", `${network}-${seedHash}.json`);
}

export function readSnapshot(path: string): WalletSnapshot | undefined {
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(readFileSync(path, "utf8")) as WalletSnapshot;
  return {
    ...raw,
    shielded: decode(raw.shielded),
    unshielded: decode(raw.unshielded),
    dust: decode(raw.dust),
  };
}

/** Serialize the three sub-wallets of a (synced) facade and write the snapshot. */
export async function saveWalletSnapshot(
  wallet: unknown,
  network: string,
  masterSeedHex: string,
): Promise<string> {
  const w = wallet as {
    shielded: { serializeState(): Promise<unknown> };
    unshielded: { serializeState(): Promise<unknown> };
    dust: { serializeState(): Promise<unknown> };
  };
  const [shielded, unshielded, dust] = await Promise.all([
    w.shielded.serializeState(),
    w.unshielded.serializeState(),
    w.dust.serializeState(),
  ]);
  const seedHash = createHash("sha256").update(masterSeedHex).digest("hex").slice(0, 16);
  const snapshot: WalletSnapshot = {
    network,
    seedHash,
    savedAt: new Date().toISOString(),
    shielded: encode(shielded),
    unshielded: encode(unshielded),
    dust: encode(dust),
  };
  const path = snapshotPath(network, masterSeedHex);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot));
  return path;
}
