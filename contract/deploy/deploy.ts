// Deploy the ZEEP contract to Midnight Preprod.
//
//   npm run deploy
//
// Prereqs: proof server on http://localhost:6300 (Docker
// midnightnetwork/proof-server:8.1.0 -- 'midnight-proof-server --network preprod'),
// and WALLET_SEED_PHRASE in contract/.env. The deploy wallet is auto-funded from
// the Preprod faucet; NIGHT is registered for DUST to cover fees.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocket } from "ws";
import pino from "pino";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";

import { preprodEnv } from "./env.js";
import { deploySeedHex } from "./seed.js";
import { CompiledZeepContract } from "./compiled.js";
import { MidnightWalletProvider } from "./midnight-wallet-provider.js";
import { waitForUnshieldedFunds, syncWallet } from "./wallet-utils.js";
import { generateDust } from "./generate-dust.js";
import { randomBytes } from "node:crypto";
import type { ZeepPrivateState } from "../src/witnesses.js";

// Apollo (indexer subscriptions) needs a global WebSocket.
// @ts-expect-error assign global
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = "zeepPrivateState";

async function main(): Promise<void> {
  const logger = pino({ level: process.env.DEBUG_LEVEL ?? "info" });
  setNetworkId("preprod");

  const seed = deploySeedHex();
  const walletProvider = await MidnightWalletProvider.build(logger, preprodEnv, seed);
  await walletProvider.start();

  const unshielded = await waitForUnshieldedFunds(
    logger,
    walletProvider.wallet,
    preprodEnv,
    unshieldedToken(),
    true, // request from faucet
  );
  const nightBalance = unshielded.balances[unshieldedToken().raw];
  if (nightBalance === undefined || nightBalance === 0n) {
    throw new Error("No NIGHT received from faucet; cannot pay deploy fees.");
  }
  logger.info(`NIGHT balance: ${nightBalance}`);

  const dustTx = await generateDust(logger, seed, unshielded, walletProvider.wallet);
  if (dustTx) await syncWallet(logger, walletProvider.wallet);

  const zkConfigPath = resolve(process.cwd(), "managed", "zeep");
  const zkConfigProvider = new NodeZkConfigProvider<"register" | "pay" | "claim">(zkConfigPath);

  const providers = {
    privateStateProvider: levelPrivateStateProvider<typeof PRIVATE_STATE_ID, ZeepPrivateState>({
      privateStateStoreName: "zeep-private-state",
      signingKeyStoreName: "zeep-private-state-signing-keys",
      privateStoragePasswordProvider: () => "zeep-deploy-2026!",
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(preprodEnv.indexer, preprodEnv.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(preprodEnv.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  const initialPrivateState: ZeepPrivateState = {
    receiverSk: new Uint8Array(randomBytes(32)),
    paymentSalt: new Uint8Array(randomBytes(32)),
    paymentAmount: 0n,
  };

  logger.info("Deploying ZEEP contract...");
  const deployed = await deployContract(providers as never, {
    compiledContract: CompiledZeepContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  } as never);

  const address = (deployed as { deployTxData: { public: { contractAddress: string } } })
    .deployTxData.public.contractAddress;
  logger.info(`ZEEP deployed at: ${address}`);

  const out = resolve(process.cwd(), "deploy", "deployed.json");
  writeFileSync(
    out,
    JSON.stringify({ network: "preprod", contractAddress: address, deployedAt: new Date().toISOString() }, null, 2),
  );
  logger.info(`Wrote ${out}`);

  await walletProvider.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
