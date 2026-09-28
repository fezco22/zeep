import { describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { MidnightBech32m, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { sendToUnshielded, type Session } from "../ui/src/zeep-app.js";

const address = (byte: number) =>
  MidnightBech32m.encode("preprod", new UnshieldedAddress(Buffer.alloc(32, byte))).asString();
const nativeType = unshieldedToken().raw;
const amount = 100_000_000n;

function fakeSession(balance = 1_500_000_000n) {
  const makeTransfer = vi.fn().mockResolvedValue({ tx_id: "00" + "a".repeat(64) });
  const submitTransaction = vi.fn();
  const session = {
    unshieldedAddress: address(1),
    api: {
      getUnshieldedBalances: vi.fn().mockResolvedValue({ [nativeType]: balance }),
      makeTransfer,
      submitTransaction,
    },
  } as unknown as Session;
  return { session, makeTransfer, submitTransaction };
}

describe("direct native tNIGHT payments", () => {
  it("uses an unshielded recipient and never submits twice when 1AM returns tx_id", async () => {
    const { session, makeTransfer, submitTransaction } = fakeSession();
    const recipient = address(2);
    const id = await sendToUnshielded(session, recipient, amount);
    expect(id).toBe("00" + "a".repeat(64));
    expect(makeTransfer).toHaveBeenCalledOnce();
    expect(makeTransfer).toHaveBeenCalledWith([
      { kind: "unshielded", type: nativeType, value: amount, recipient },
    ], { payFees: true });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("rejects a self payment and a malformed destination before wallet submission", async () => {
    const { session, makeTransfer } = fakeSession();
    await expect(sendToUnshielded(session, session.unshieldedAddress, amount)).rejects.toThrow("your own wallet");
    await expect(sendToUnshielded(session, "mn_shield-addr_preprod1bad", amount)).rejects.toThrow("unshielded address");
    expect(makeTransfer).not.toHaveBeenCalled();
  });

  it("rejects too little spendable tNIGHT before requesting transfer", async () => {
    const { session, makeTransfer } = fakeSession(50_000_000n);
    await expect(sendToUnshielded(session, address(2), amount)).rejects.toThrow("less spendable");
    expect(makeTransfer).not.toHaveBeenCalled();
  });
});
