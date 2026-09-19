// Wallet sync + faucet-funding helpers. Adapted from example-bboard (Apache-2.0).
import { UnshieldedTokenType } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { type FacadeState, type WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { type ShieldedWalletAPI, type ShieldedWalletState } from "@midnight-ntwrk/wallet-sdk-shielded";
import {
  type UnshieldedWalletAPI,
  type UnshieldedWalletState,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import * as Rx from "rxjs";
import { FaucetClient, type EnvironmentConfiguration } from "@midnight-ntwrk/testkit-js";
import { Logger } from "pino";
import { UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

export const getInitialShieldedState = async (
  logger: Logger,
  wallet: ShieldedWalletAPI,
): Promise<ShieldedWalletState> => {
  logger.info("Getting initial state of wallet...");
  return Rx.firstValueFrom(wallet.state);
};

export const getInitialUnshieldedState = async (
  logger: Logger,
  wallet: UnshieldedWalletAPI,
): Promise<UnshieldedWalletState> => {
  logger.info("Getting initial unshielded state of wallet...");
  return Rx.firstValueFrom(wallet.state);
};

const isProgressStrictlyComplete = (progress: unknown): boolean => {
  if (!progress || typeof progress !== "object") return false;
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== "function") return false;
  return (candidate.isStrictlyComplete as () => boolean)();
};

const isFacadeStateSynced = (state: FacadeState): boolean =>
  isProgressStrictlyComplete(state.shielded.state.progress) &&
  isProgressStrictlyComplete(state.dust.state.progress) &&
  isProgressStrictlyComplete(state.unshielded.progress);

export const syncWallet = (logger: Logger, wallet: WalletFacade, throttleTime = 2_000) => {
  logger.info("Syncing wallet...");
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(throttleTime),
      Rx.filter((state: FacadeState) => isFacadeStateSynced(state)),
      Rx.tap(() => logger.info("Sync complete")),
    ),
  );
};

export const unshieldedAddressString = async (
  logger: Logger,
  wallet: WalletFacade,
): Promise<string> => {
  const initialState = await getInitialUnshieldedState(logger, wallet.unshielded);
  return UnshieldedAddress.codec.encode(getNetworkId(), initialState.address).toString();
};

export const waitForUnshieldedFunds = async (
  logger: Logger,
  wallet: WalletFacade,
  env: EnvironmentConfiguration,
  tokenType: UnshieldedTokenType,
  fundFromFaucet = false,
  throttleTime = 2_000,
): Promise<UnshieldedWalletState> => {
  const initialState = await getInitialUnshieldedState(logger, wallet.unshielded);
  const unshieldedAddress = UnshieldedAddress.codec.encode(getNetworkId(), initialState.address);
  logger.info(`Using unshielded address: ${unshieldedAddress.toString()} waiting for funds...`);
  if (fundFromFaucet && env.faucet) {
    logger.info("Requesting tokens from faucet...");
    await new FaucetClient(env.faucet, logger).requestTokens(unshieldedAddress.toString());
  }
  const initialBalance = initialState.balances[tokenType.raw];
  if (initialBalance === undefined || initialBalance === 0n) {
    logger.info("Wallet initial balance is 0; waiting to receive tokens...");
    return Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(throttleTime),
        Rx.filter(
          (state: FacadeState) =>
            isFacadeStateSynced(state) && (state.unshielded.balances[tokenType.raw] ?? 0n) > 0n,
        ),
        Rx.tap(() => logger.info("Funds received")),
        Rx.map((state: FacadeState) => state.unshielded),
      ),
    );
  }
  return initialState;
};
