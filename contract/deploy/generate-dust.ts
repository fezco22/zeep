// Register NIGHT UTXOs for DUST generation so the wallet can pay tx fees.
// Follows the midnight-js skill flow: no dust.waitForSyncedState() (which hangs
// on Preprod); register the available NIGHT UTXOs directly (the registration
// covers its own fee) and wait for a positive DUST balance to accrue.
import { type WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { Logger } from "pino";
import * as rx from "rxjs";
import { preprodEnv } from "./env.js";
import { submitStable } from "./submit.js";

type UnshieldedKeystore = {
  getPublicKey(): any;
  signData(payload: Uint8Array): any;
};

export const generateDust = async (
  logger: Logger,
  walletFacade: WalletFacade,
  keystore: UnshieldedKeystore,
): Promise<string | undefined> => {
  const state: any = await rx.firstValueFrom(walletFacade.state());
  if (state.dust.balance(new Date()) > 0n) {
    logger.info("DUST already available");
    return;
  }
  const utxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (utxos.length === 0) {
    logger.info("No unregistered NIGHT UTXOs for dust generation.");
    return;
  }
  logger.info(`Registering ${utxos.length} NIGHT UTXO(s) for DUST generation...`);
  const recipe = await walletFacade.registerNightUtxosForDustGeneration(
    utxos,
    keystore.getPublicKey(),
    (payload: Uint8Array) => keystore.signData(payload),
  );
  const transaction = await walletFacade.finalizeRecipe(recipe);
  const txId = await submitStable((preprodEnv as unknown as { node: string }).node, transaction);
  logger.info(`DUST registration tx submitted: ${txId}. Waiting for DUST to accrue...`);
  // Bounded wait: give DUST time to accrue/sync, but proceed to deploy anyway if
  // the wallet has not surfaced a positive balance within the window. balanceTx
  // can still draw on the registered generation on-chain.
  const boundMs = Number(process.env.DUST_WAIT_MS ?? 600_000);
  const dustBalance = await rx.firstValueFrom(
    walletFacade.state().pipe(
      rx.throttleTime(15_000),
      rx.tap((s: any) => logger.info(`dust balance so far: ${s.dust.balance(new Date())}`)),
      rx.filter((s: any) => s.dust.balance(new Date()) > 0n),
      rx.map((s: any) => s.dust.balance(new Date())),
      rx.timeout(boundMs),
    ),
  ).catch(() => {
    logger.info(`DUST not visible within ${boundMs}ms; proceeding to deploy anyway.`);
    return 0n;
  });
  logger.info(`DUST balance: ${dustBalance}`);
  return txId;
};
