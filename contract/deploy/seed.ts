// Resolve the deploy wallet seed as a 32-byte hex string.
// Accepts either a raw 64-char hex seed or a BIP39 mnemonic (converted to its
// 32-byte entropy). The deploy wallet is throwaway and funded from the faucet,
// so the only requirement is that address derivation and deploy use the same seed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mnemonicToEntropy } from "bip39";

// Minimal .env loader (avoids a dotenv dependency). Only reads WALLET_SEED_PHRASE.
function loadPhrase(): string {
  const fromEnv = process.env.WALLET_SEED_PHRASE?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*WALLET_SEED_PHRASE\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* no .env file */
  }
  throw new Error("WALLET_SEED_PHRASE not set (contract/.env)");
}

export function deploySeedHex(): string {
  const phrase = loadPhrase();
  if (/^[0-9a-fA-F]{64}$/.test(phrase)) return phrase.toLowerCase();
  return mnemonicToEntropy(phrase); // 24-word mnemonic -> 32-byte entropy hex
}
