/** 1AM can approve a DApp before its shielded, unshielded, and DUST state is synced. */
export function isWalletSyncError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /wallet is syncing|address not yet available|wallet.*not ready/i.test(message);
}

function isRateLimited(error: unknown): boolean {
  return /rate limited/i.test(error instanceof Error ? error.message : String(error));
}

type AddressApi = Pick<DAppConnectorConnectedAPI, "getShieldedAddresses" | "getUnshieldedAddress">;
type ShieldedAddresses = Awaited<ReturnType<AddressApi["getShieldedAddresses"]>>;
type UnshieldedAddress = Awaited<ReturnType<AddressApi["getUnshieldedAddress"]>>;

export type ReadyAddresses = { shielded: ShieldedAddresses; unshielded: UnshieldedAddress };

export async function waitForWalletAddresses(
  api: AddressApi,
  onProgress?: (message: string) => void,
  options: { maxAttempts?: number; retryMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReadyAddresses> {
  const maxAttempts = options.maxAttempts ?? 60;
  const retryMs = options.retryMs ?? 3_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let shielded: ShieldedAddresses | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let stage = "shielded address";
    try {
      // Sequential calls avoid flooding 1AM's DApp API while it is loading.
      shielded ??= await api.getShieldedAddresses();
      if (!shielded.shieldedAddress || !shielded.shieldedCoinPublicKey || !shielded.shieldedEncryptionPublicKey) {
        shielded = undefined;
        throw new Error("Wallet address not yet available");
      }
      stage = "unshielded address";
      const unshielded = await api.getUnshieldedAddress();
      if (!unshielded.unshieldedAddress) throw new Error("Wallet address not yet available");
      return { shielded, unshielded };
    } catch (error) {
      if (!isWalletSyncError(error) && !isRateLimited(error)) {
        throw new Error(`1AM ${stage} read failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      if (attempt === maxAttempts) {
        const reason = isRateLimited(error) ? "1AM is still rate limiting wallet reads" : `its ${stage} is still unavailable after wallet sync retries`;
        throw new Error(`1AM approved the connection, but ${reason}. Keep 1AM open until it shows Synced, then press Connect wallet again. ZEEP will reuse the approved connection.`, { cause: error });
      }
      onProgress?.(`1AM connected. Waiting for ${stage} (${attempt}/${maxAttempts})...`);
      await sleep(retryMs);
    }
  }
  throw new Error("Wallet address check stopped unexpectedly.");
}
