// Path B: build a WalletFacade by hand so the DUST wallet syncs through a
// reconnecting sync service. FluentWalletBuilder (testkit) hardwires the default
// dust sync, whose indexer WebSocket subscription dies on a "Normal Closure" and
// never resubscribes -- so on Preprod the dust balance never surfaces and
// balanceTx fails with `Wallet.InsufficientFunds: could not balance dust`.
//
// We replicate testkit's WalletFactory assembly exactly (same HD seed derivation,
// same config shape, so the funded address is unchanged) but swap the dust wallet
// for CustomDustWallet(config, V1Builder().withDefaults().withSync(reconnecting)).
import { Buffer } from "node:buffer";
import { Stream, Schedule, Duration } from "effect";
import {
  HDWallet,
  Roles,
  createKeystore,
  ShieldedWallet,
  UnshieldedWallet,
  PublicKey,
  CustomDustWallet,
  WalletFacade,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  mergeWalletEntries,
} from "@midnight-ntwrk/wallet-sdk";
import { V1Builder, SyncService } from "@midnight-ntwrk/wallet-sdk-dust-wallet/v1";
import { LedgerParameters } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { EnvironmentConfiguration } from "@midnight-ntwrk/testkit-js";
import type { Logger } from "pino";
import { readSnapshot, snapshotPath } from "./wallet-persist.js";

export type DustOptions = {
  ledgerParams: unknown;
  additionalFeeOverhead: bigint;
  feeBlocksMargin: number;
};

export type WalletSeeds = {
  masterSeed: string;
  shielded: Uint8Array;
  unshielded: Uint8Array;
  dust: Uint8Array;
};

export type CustomWalletBuildResult = {
  wallet: unknown;
  seeds: WalletSeeds;
  keystore: unknown;
};

// Mirrors testkit's deriveKeyForRole(seed, role, account=0, keyIndex=0).
function deriveKeyForRole(seedHex: string, role: unknown): Uint8Array {
  if (!seedHex || seedHex.length === 0) throw new Error("Seed cannot be empty");
  const seedBuffer = Buffer.from(seedHex, "hex");
  const r = HDWallet.fromSeed(seedBuffer) as { type: string; hdWallet: any };
  if (r.type !== "seedOk") throw new Error("Invalid seed: failed to create HD wallet");
  const d = r.hdWallet.selectAccount(0).selectRole(role).deriveKeyAt(0) as {
    type: string;
    key: Uint8Array;
  };
  if (d.type === "keyOutOfBounds") throw new Error("Key derivation out of bounds");
  return d.key;
}

function seedsFromMaster(masterSeedHex: string): WalletSeeds {
  const R = Roles as unknown as { Zswap: unknown; NightExternal: unknown; Dust: unknown };
  return {
    masterSeed: masterSeedHex,
    shielded: deriveKeyForRole(masterSeedHex, R.Zswap),
    unshielded: deriveKeyForRole(masterSeedHex, R.NightExternal),
    dust: deriveKeyForRole(masterSeedHex, R.Dust),
  };
}

// Mirrors testkit's mapEnvironmentToConfiguration(env).
function mapEnvironmentToConfiguration(env: EnvironmentConfiguration): Record<string, unknown> {
  const e = env as unknown as {
    indexer: string;
    indexerWS: string;
    proofServer: string;
    walletNetworkId: string;
    nodeWS: string;
  };
  // Larger batches / higher resume threshold cut the number of resubscribes and
  // scheduling gaps during the multi-million-event dust catch-up from genesis.
  return {
    indexerClientConnection: {
      indexerHttpUrl: e.indexer,
      indexerWsUrl: e.indexerWS,
      keepAlive: 30_000,
      bufferSize: 50_000,
      resumeThreshold: 20_000,
    },
    batchUpdates: { size: 500, spacing: 0, timeout: 1 },
    provingServerUrl: new URL(e.proofServer),
    networkId: e.walletNetworkId,
    relayURL: new URL(e.nodeWS),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    costParameters: { feeBlocksMargin: 5 },
  };
}

/**
 * A dust sync service that wraps the default one and resubscribes on failure
 * (e.g. the indexer WebSocket closing with "Normal Closure"). Without this the
 * default stream terminates on the first close and dust never syncs.
 */
function makeReconnectingSyncService(logger: Logger) {
  return (config: unknown, getContext: unknown) => {
    const inner = (SyncService as any).makeDefaultSyncService(config, getContext);
    return {
      ...inner,
      updates: (state: unknown, secretKey: unknown) =>
        (inner.updates(state, secretKey) as any).pipe(
          Stream.tapError((err: unknown) =>
            Stream.fromEffect(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (async () => logger.warn(`dust sync stream error, resubscribing: ${String(err)}`)) as any,
            ),
          ),
          Stream.retry(Schedule.spaced(Duration.seconds(2))),
        ),
    };
  };
}

/**
 * Build an unstarted WalletFacade whose dust wallet uses the reconnecting sync
 * service. Returns the same shape as FluentWalletBuilder.buildWithoutStarting().
 */
export async function buildCustomWallet(
  logger: Logger,
  env: EnvironmentConfiguration,
  masterSeedHex: string,
  dustOptions: DustOptions,
): Promise<CustomWalletBuildResult> {
  const config = mapEnvironmentToConfiguration(env);
  const networkId = (config as { networkId: string }).networkId;
  const seeds = seedsFromMaster(masterSeedHex);

  // Restore from a prior snapshot when present, so the wallets resume near the
  // chain tip instead of replaying dust events from genesis.
  const snap = readSnapshot(snapshotPath(networkId, masterSeedHex));
  if (snap) logger.info(`Restoring wallet state from snapshot (saved ${snap.savedAt}).`);

  const unshieldedKeystore = createKeystore(seeds.unshielded, networkId);
  const ShieldedFactory = (ShieldedWallet as any)(config);
  const shieldedWallet = snap
    ? ShieldedFactory.restore(snap.shielded)
    : ShieldedFactory.startWithSeed(seeds.shielded);
  const UnshieldedFactory = (UnshieldedWallet as any)({
    ...config,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  });
  const unshieldedWallet = snap
    ? UnshieldedFactory.restore(snap.unshielded)
    : UnshieldedFactory.startWithPublicKey((PublicKey as any).fromKeyStore(unshieldedKeystore));

  const dustConfig = {
    ...config,
    costParameters: {
      ledgerParams: dustOptions.ledgerParams,
      additionalFeeOverhead: dustOptions.additionalFeeOverhead,
      feeBlocksMargin: dustOptions.feeBlocksMargin,
    },
  };
  const builder = new V1Builder().withDefaults().withSync(
    makeReconnectingSyncService(logger) as never,
    (SyncService as any).makeDefaultSyncCapability,
  );
  const dustParameters = (LedgerParameters as any).initialParameters().dust;
  const DustFactory = (CustomDustWallet as any)(dustConfig, builder);
  const dustWallet = snap
    ? DustFactory.restore(snap.dust)
    : DustFactory.startWithSeed(seeds.dust, dustParameters);

  const wallet = await (WalletFacade as any).init({
    configuration: config,
    shielded: () => shieldedWallet,
    unshielded: () => unshieldedWallet,
    dust: () => dustWallet,
  });

  logger.info("Built custom WalletFacade with reconnecting dust sync (Path B).");
  return { wallet, seeds, keystore: unshieldedKeystore };
}
