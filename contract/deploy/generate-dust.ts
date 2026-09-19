// Register NIGHT UTXOs for DUST generation so the wallet can pay tx fees.
// Follows the midnight-js skill flow: no dust.waitForSyncedState() (which hangs
// on Preprod); register the available NIGHT UTXOs directly (the registration
// covers its own fee) and wait for a positive DUST balance to accrue.
import { type WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { Logger } from "pino";
import * as rx from "rxjs";

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
  const txId = await walletFacade.submitTransaction(transaction);
  logger.info(`DUST registration tx submitted: ${txId}. Waiting for DUST to accrue...`);
  const dustBalance = await rx.firstValueFrom(
    walletFacade.state().pipe(
      rx.throttleTime(5_000),
      rx.filter((s: any) => s.dust.balance(new Date()) > 0n),
      rx.map((s: any) => s.dust.balance(new Date())),
    ),
  );
  logger.info(`DUST available: ${dustBalance}`);
  return txId;
};
