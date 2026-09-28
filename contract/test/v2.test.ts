import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCircuitContext, createConstructorContext, sampleContractAddress } from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger } from "../v2/managed/zeep/contract/index.js";
import { v2Witnesses, type ZeepV2PrivateState } from "../v2/witnesses.js";

const bytes = (value: number) => new Uint8Array(32).fill(value);
const hash = (name: string) => createHash("sha256").update(name).digest();
const displayName = (name: string) => {
  const result = new Uint8Array(32);
  result.set(new TextEncoder().encode(name));
  return result;
};

async function simulator() {
  const contract = new Contract<ZeepV2PrivateState>(v2Witnesses);
  const address = sampleContractAddress();
  const initial = await contract.initialState(createConstructorContext({ ownerSecret: bytes(1) }, "0".repeat(64)));
  let state = initial.currentContractState.data;
  let zswap = initial.currentZswapLocalState;
  return {
    async register(ownerSecret: Uint8Array, name: string, coin: Uint8Array, encryption: Uint8Array) {
      const context = createCircuitContext(address, zswap, state, { ownerSecret });
      const result = await contract.circuits.register(context, hash(name), displayName(name), coin, encryption);
      state = result.context.currentQueryContext.state;
      zswap = result.context.currentZswapLocalState;
    },
    ledger: () => ledger(state),
  };
}

describe("deployed v2 registry behavior", () => {
  it("stores a unique handle and both shielded recipient keys", async () => {
    const sim = await simulator();
    await sim.register(bytes(1), "zeep", bytes(2), bytes(3));
    const data = sim.ledger();
    expect(data.usernames.member(hash("zeep"))).toBe(true);
    expect(data.handleNames.lookup(hash("zeep"))).toEqual(displayName("zeep"));
    expect(data.recipientCoins.lookup(hash("zeep"))).toEqual(bytes(2));
    expect(data.recipientEncryptions.lookup(hash("zeep"))).toEqual(bytes(3));
  });

  it("rejects a second handle for the same supplied identity and duplicate handles", async () => {
    const sim = await simulator();
    await sim.register(bytes(1), "zeep", bytes(2), bytes(3));
    await expect(sim.register(bytes(1), "dori", bytes(4), bytes(5))).rejects.toThrow("wallet already has a handle");
    await expect(sim.register(bytes(9), "zeep", bytes(4), bytes(5))).rejects.toThrow("handle already registered");
  });

  it("documents that the contract accepts a different caller-supplied identity", async () => {
    const sim = await simulator();
    await sim.register(bytes(1), "zeep", bytes(2), bytes(3));
    await sim.register(bytes(9), "dori", bytes(4), bytes(5));
    expect(sim.ledger().walletHandles.size()).toBe(2n);
  });
});
