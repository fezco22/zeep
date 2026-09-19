// Print the Preprod unshielded address of the deploy wallet, for manual faucet
// funding if the automated faucet request is unavailable.
//
//   npm run address
import pino from "pino";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { preprodEnv } from "./env.js";
import { deploySeedHex } from "./seed.js";
import { MidnightWalletProvider } from "./midnight-wallet-provider.js";
import { unshieldedAddressString } from "./wallet-utils.js";

async function main(): Promise<void> {
  const logger = pino({ level: "info" }, pino.destination({ sync: true }));
  process.stderr.write("[address] start\n");
  setNetworkId("preprod");
  const seed = deploySeedHex();
  process.stderr.write(`[address] seed loaded (${seed.length} hex chars)\n`);
  const walletProvider = await MidnightWalletProvider.build(logger, preprodEnv, seed);
  process.stderr.write("[address] wallet built\n");
  const address = await unshieldedAddressString(logger, walletProvider.wallet);
  process.stdout.write(`ADDRESS=${address}\n`);
  await walletProvider.stop();
  await new Promise((r) => setTimeout(r, 200));
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`[address] ERROR: ${e?.stack ?? e}\n`);
  process.exit(1);
});
