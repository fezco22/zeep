import { describe, expect, it, vi } from "vitest";
import { isWalletSyncError, waitForWalletAddresses } from "../ui/src/wallet-ready.js";

const shielded = {
  shieldedAddress: "mn_shield-addr_preprod1example",
  shieldedCoinPublicKey: "coin-key",
  shieldedEncryptionPublicKey: "encryption-key",
};
const unshielded = { unshieldedAddress: "mn_addr_preprod1example" };

describe("wallet readiness after 1AM approval", () => {
  it("retries only sync errors and reuses a successful shielded address read", async () => {
    const getShieldedAddresses = vi.fn()
      .mockRejectedValueOnce(new Error("Wallet is syncing — open 1AM and wait for sync to finish"))
      .mockResolvedValue(shielded);
    const getUnshieldedAddress = vi.fn()
      .mockRejectedValueOnce(new Error("Wallet is syncing — unshielded address not yet available"))
      .mockResolvedValue(unshielded);
    const progress = vi.fn();
    const result = await waitForWalletAddresses(
      { getShieldedAddresses, getUnshieldedAddress }, progress,
      { maxAttempts: 4, retryMs: 0, sleep: async () => {} },
    );
    expect(result).toEqual({ shielded, unshielded });
    expect(getShieldedAddresses).toHaveBeenCalledTimes(2);
    expect(getUnshieldedAddress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("surfaces a rejected permission immediately", async () => {
    const api = {
      getShieldedAddresses: vi.fn().mockRejectedValue(new Error("User rejected the request")),
      getUnshieldedAddress: vi.fn(),
    };
    await expect(waitForWalletAddresses(api, undefined, { maxAttempts: 3, retryMs: 0, sleep: async () => {} }))
      .rejects.toThrow("User rejected the request");
    expect(api.getShieldedAddresses).toHaveBeenCalledTimes(1);
  });

  it("reports a persistent wallet sync without pretending approval failed", async () => {
    const api = {
      getShieldedAddresses: vi.fn().mockRejectedValue(new Error("Wallet is syncing")),
      getUnshieldedAddress: vi.fn(),
    };
    await expect(waitForWalletAddresses(api, undefined, { maxAttempts: 3, retryMs: 0, sleep: async () => {} }))
      .rejects.toThrow("approved the connection, but its shielded address is still unavailable");
    expect(api.getShieldedAddresses).toHaveBeenCalledTimes(3);
    expect(isWalletSyncError(new Error("Wallet is syncing"))).toBe(true);
  });
});
