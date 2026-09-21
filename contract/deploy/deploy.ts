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
import * as rx from "rxjs";
import pino from "pino";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { createUnprovenDeployTx, submitTxAsync } from "@midnight-ntwrk/midnight-js-contracts";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";

import { preprodEnv } from "./env.js";
import { deploySeedHex } from "./seed.js";
import { CompiledZeepContract } from "./compiled.js";
import { MidnightWalletProvider } from "./midnight-wallet-provider.js";
import { waitForUnshieldedFunds, syncWallet } from "./wallet-utils.js";
import { generateDust } from "./generate-dust.js";
import { saveWalletSnapshot } from "./wallet-persist.js";
import { randomBytes } from "node:crypto";
import type { ZeepPrivateState } from "../src/witnesses.js";

// Apollo (indexer subscriptions) needs a global WebSocket.
// @ts-expect-error assign global
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = "zeepPrivateState";

// Block until the dust wallet reports a positive spendable balance. Logs sync
// progress (appliedIndex vs tip) every 15s so a long genesis catch-up is visible.
async function waitForDust(logger: pino.Logger, wallet: unknown): Promise<bigint> {
  const deadlineMs = Number(process.env.DUST_DEADLINE_MS ?? 4 * 3600_000);
  // The DUST fee proof is validated against the chain tip: submitting while the
  // dust wallet is behind the tip yields `Invalid Transaction: Custom error: 170`
  // (InvalidDustSpendProof). So gate on a positive balance AND being within a
  // small gap of the tip, not just balance > 0.
  const maxGap = BigInt(process.env.DUST_SYNC_GAP ?? "8");
  const balOf = (s: any): bigint => {
    try {
      return s.dust.balance(new Date());
    } catch {
      return 0n;
    }
  };
  const progOf = (s: any): { applied: bigint; tip: bigint } => {
    const p = s?.dust?.state?.progress ?? s?.dust?.progress ?? {};
    return {
      applied: BigInt(p.appliedIndex ?? 0),
      tip: BigInt(p.highestRelevantWalletIndex ?? 0),
    };
  };
  logger.info(`Waiting for dust to sync to tip + accrue (deadline ${deadlineMs}ms, maxGap ${maxGap})...`);
  const bal = await rx.firstValueFrom(
    (wallet as { state(): rx.Observable<unknown> }).state().pipe(
      rx.throttleTime(15_000),
      rx.tap((s: any) => {
        const { applied, tip } = progOf(s);
        logger.info(`dust sync appliedIdx=${applied} tip=${tip} gap=${tip - applied} bal=${balOf(s)}`);
      }),
      rx.filter((s: unknown) => {
        const { applied, tip } = progOf(s);
        return balOf(s) > 0n && tip > 0n && tip - applied <= maxGap;
      }),
      rx.map((s: unknown) => balOf(s)),
      rx.timeout(deadlineMs),
    ),
  );
  logger.info(`Dust available and synced to tip: ${bal}`);
  return bal;
}

async function main(): Promise<void> {
  const logger = pino({ level: process.env.DEBUG_LEVEL ?? "info" });
  setNetworkId("preprod");

  const seed = deploySeedHex();
  const walletProvider = await MidnightWalletProvider.build(logger, preprodEnv, seed);
  await walletProvider.start();

  // Faucet requires a Cloudflare Turnstile captcha, so it cannot be requested
  // programmatically. Fund the address (see `npm run address`) from
  // https://faucet.preprod.midnight.network/ first, then run this. Set
  // FUND_FROM_FAUCET=1 only if a captcha-exempt faucet is configured.
  const fundFromFaucet = process.env.FUND_FROM_FAUCET === "1";
  const unshielded = await waitForUnshieldedFunds(
    logger,
    walletProvider.wallet,
    preprodEnv,
    unshieldedToken(),
    fundFromFaucet,
  );
  const nightBalance = unshielded.balances[unshieldedToken().raw];
  if (nightBalance === undefined || nightBalance === 0n) {
    throw new Error("No NIGHT received from faucet; cannot pay deploy fees.");
  }
  logger.info(`NIGHT balance: ${nightBalance}`);

  await generateDust(logger, walletProvider.wallet, walletProvider.unshieldedKeystore);

  // Hard gate: the dust wallet must sync from genesis (~1.5M events) and surface a
  // positive balance before deployContract can balance the fee. Registration is
  // already on-chain, so generateDust returns early -- we block here until the
  // dust wallet reports spendable dust (deadline DUST_DEADLINE_MS, default 4h).
  await waitForDust(logger, walletProvider.wallet);

  // Snapshot the now-synced wallet so future deploys restore instead of replaying
  // dust from genesis. Best-effort: a save failure must not abort the deploy.
  try {
    const snapPath = await saveWalletSnapshot(walletProvider.wallet, "preprod", seed);
    logger.info(`Saved wallet snapshot: ${snapPath}`);
  } catch (e) {
    logger.warn(`Snapshot save failed (continuing): ${String(e)}`);
  }

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

  // Use the low-level path: createUnprovenDeployTx exposes the contract address up
  // front, and submitTxAsync submits WITHOUT the finalization watch that the
  // high-level deployContract does (`publicDataProvider.watchForTxData`) -- that
  // watch hangs indefinitely on Preprod's flaky indexer WS. A stale dust proof
  // (170) or a submit timeout is only fixable by rebuilding + re-proving, so retry.
  const maxAttempts = Number(process.env.DEPLOY_ATTEMPTS ?? 5);
  let address = "";
  let txId = "";
  for (let attempt = 1; ; attempt++) {
    try {
      logger.info(`Building + submitting ZEEP deploy tx (attempt ${attempt}/${maxAttempts})...`);
      const deployTxData = await createUnprovenDeployTx(providers as never, {
        compiledContract: CompiledZeepContract,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState,
      } as never);
      address = (deployTxData as { public: { contractAddress: string } }).public.contractAddress;
      logger.info(`Deploy tx built. Contract address: ${address}. Proving + submitting...`);
      txId = await submitTxAsync(providers as never, {
        unprovenTx: (deployTxData as { private: { unprovenTx: unknown } }).private.unprovenTx,
      } as never);
      logger.info(`Submitted deploy tx: ${txId}`);
      break;
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      const retriable =
        /Custom error: 170|InvalidDustSpendProof|Invalid Transaction|submit timeout|disconnected|Priority is too low|1014/i.test(
          msg,
        );
      if (!retriable || attempt >= maxAttempts) throw e;
      logger.warn(`Attempt ${attempt} failed (retriable: stale proof / submit timeout); rebuilding. ${msg}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  logger.info(`ZEEP deployed at: ${address} (tx ${txId})`);

  const out = resolve(process.cwd(), "deploy", "deployed.json");
  writeFileSync(
    out,
    JSON.stringify({ network: "preprod", contractAddress: address, txId, deployedAt: new Date().toISOString() }, null, 2),
  );
  logger.info(`Wrote ${out}`);

  await walletProvider.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
