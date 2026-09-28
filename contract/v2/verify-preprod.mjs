// Read-only check that the active UI artifacts decode the deployed v2 directory.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { ledger as decodeLedger } from "./managed/zeep/contract/index.js";

const contractAddress = "10d4dee9b10adec9a98e409bd2abd509bbe34ac911d68a25f227cbc40b26f87f";
const provider = indexerPublicDataProvider(
  "https://indexer.preprod.midnight.network/api/v4/graphql",
  "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
);
const state = await provider.queryContractState(contractAddress);
if (!state) throw new Error("v2 contract is absent from the Preprod indexer");

const verifierPath = fileURLToPath(new URL("./managed/zeep/keys/register.verifier", import.meta.url));
const localVerifier = await readFile(verifierPath);
const chainVerifier = Buffer.from(state.operation("register")?.verifierKey ?? []);
if (!chainVerifier.equals(localVerifier)) throw new Error("Local register verifier differs from deployed v2 contract");

const registry = decodeLedger(state.data);
const handles = ["zeep", "dori"];
for (const handle of handles) {
  const hash = createHash("sha256").update(handle).digest();
  if (!registry.usernames.member(hash)) throw new Error(`@${handle} is absent from v2`);
  const coin = new ShieldedCoinPublicKey(Buffer.from(registry.recipientCoins.lookup(hash)));
  const encryption = new ShieldedEncryptionPublicKey(Buffer.from(registry.recipientEncryptions.lookup(hash)));
  const address = MidnightBech32m.encode("preprod", new ShieldedAddress(coin, encryption)).asString();
  console.log(`@${handle}: ${address.slice(0, 24)}…${address.slice(-12)}`);
}
console.log(`v2 directory readable; ${registry.usernames.size()} handles; verifier SHA256 ${createHash("sha256").update(localVerifier).digest("hex")}`);
