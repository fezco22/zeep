// WalletProvider + MidnightProvider backed by the wallet-sdk facade.
// Adapted from example-bboard bboard-cli/src/midnight-wallet-provider.ts (Apache-2.0).
import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import {
  type MidnightProvider,
  type UnboundTransaction,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { ttlOneHour } from "@midnight-ntwrk/midnight-js-utils";
import { type WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import type { Logger } from "pino";
import { getInitialShieldedState } from "./wallet-utils.js";
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
} from "@midnight-ntwrk/testkit-js";
import { submitStable } from "./submit.js";
import { buildCustomWallet } from "./custom-wallet.js";

type UnshieldedKeystore = {
  getPublicKey(): unknown;
  signData(payload: Uint8Array): string;
};

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  logger: Logger;
  readonly env: EnvironmentConfiguration;
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;
  readonly zswapSecretKeys: ZswapSecretKeys;
  readonly dustSecretKey: DustSecretKey;

  private constructor(
    logger: Logger,
    environmentConfiguration: EnvironmentConfiguration,
    wallet: WalletFacade,
    zswapSecretKeys: ZswapSecretKeys,
    dustSecretKey: DustSecretKey,
    unshieldedKeystore: UnshieldedKeystore,
  ) {
    this.logger = logger;
    this.env = environmentConfiguration;
    this.wallet = wallet;
    this.zswapSecretKeys = zswapSecretKeys;
    this.dustSecretKey = dustSecretKey;
    this.unshieldedKeystore = unshieldedKeystore;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.zswapSecretKeys, dustSecretKey: this.dustSecretKey },
      { ttl },
    );
    const signedRecipe = await this.wallet.signRecipe(recipe, (payload) =>
      this.unshieldedKeystore.signData(payload),
    );
    return this.wallet.finalizeRecipe(signedRecipe);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    // Bypass the SDK submission service (premature disconnect bug on Preprod).
    return submitStable((this.env as unknown as { node: string }).node, tx);
  }

  async start(): Promise<void> {
    this.logger.info("Starting wallet...");
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    seed?: string,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: BigInt(process.env.DUST_FEE_OVERHEAD ?? "1000"),
      feeBlocksMargin: 5,
    };
    // Path B (default): assemble the WalletFacade by hand so the dust wallet uses
    // a reconnecting sync service (see custom-wallet.ts). Set USE_DEFAULT_DUST_SYNC=1
    // to fall back to the stock FluentWalletBuilder for comparison.
    const useDefault = process.env.USE_DEFAULT_DUST_SYNC === "1";
    let wallet: WalletFacade;
    let seeds: { masterSeed: string; shielded: Uint8Array; dust: Uint8Array };
    let keystore: UnshieldedKeystore;
    if (useDefault) {
      const builder = FluentWalletBuilder.forEnvironment(env).withDustOptions(dustOptions);
      const buildResult = seed
        ? await builder.withSeed(seed).buildWithoutStarting()
        : await builder.withRandomSeed().buildWithoutStarting();
      ({ wallet, seeds, keystore } = buildResult as unknown as {
        wallet: WalletFacade;
        seeds: { masterSeed: string; shielded: Uint8Array; dust: Uint8Array };
        keystore: UnshieldedKeystore;
      });
    } else {
      if (!seed) throw new Error("Path B custom wallet requires a seed");
      const buildResult = await buildCustomWallet(logger, env, seed, dustOptions);
      wallet = buildResult.wallet as WalletFacade;
      seeds = buildResult.seeds as { masterSeed: string; shielded: Uint8Array; dust: Uint8Array };
      keystore = buildResult.keystore as UnshieldedKeystore;
    }

    const initialState = await getInitialShieldedState(logger, wallet.shielded);
    logger.info(`Wallet address (shielded): ${initialState.address.coinPublicKeyString()}`);

    return new MidnightWalletProvider(
      logger,
      env,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );
  }
}
