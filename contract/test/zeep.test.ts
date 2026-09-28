import { describe, it, expect, beforeEach } from "vitest";
import { createConstructorContext, createCircuitContext, sampleContractAddress, persistentHash, CompactTypeBytes } from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, type Ledger } from "../managed/zeep/contract/index.js";
import { witnesses, type ZeepPrivateState } from "../src/witnesses.js";

const ZERO_CPK = "0".repeat(64);
const b32 = (fill: number) => new Uint8Array(32).fill(fill);

class Sim {
  private constructor(
    private contract: Contract<ZeepPrivateState>,
    private address: string,
    private ps: ZeepPrivateState,
    private state: any,
    private zswap: any,
  ) {}

  static async create(initialPS: ZeepPrivateState): Promise<Sim> {
    const contract = new Contract<ZeepPrivateState>(witnesses);
    const c = await contract.initialState(createConstructorContext(initialPS, ZERO_CPK));
    return new Sim(contract, sampleContractAddress(), c.currentPrivateState, c.currentContractState.data, c.currentZswapLocalState);
  }

  private async call(args: Uint8Array[]) {
    const ctx = createCircuitContext(this.address, this.zswap, this.state, this.ps);
    const res = await this.contract.circuits.register(ctx as any, ...args);
    this.state = res.context.currentQueryContext.state;
    this.ps = res.context.currentPrivateState as ZeepPrivateState;
    this.zswap = res.context.currentZswapLocalState;
    return res;
  }

  register(nameHash: Uint8Array, nameBytes: Uint8Array, address: Uint8Array) {
    return this.call([nameHash, nameBytes, address]);
  }
  ledger(): Ledger { return ledger(this.state); }
}

const NAME_BYTES = new Uint8Array(32);
NAME_BYTES.set(new TextEncoder().encode("zeep"));
const OTHER_BYTES = new Uint8Array(32);
OTHER_BYTES.set(new TextEncoder().encode("dori"));
const hashName = (bytes: Uint8Array) => persistentHash(new CompactTypeBytes(32), bytes) as Uint8Array;
const NAME = hashName(NAME_BYTES);
const PS: ZeepPrivateState = {};

describe("ZEEP contract registry", () => {
  let sim: Sim;
  beforeEach(async () => { sim = await Sim.create(PS); });

  it("registers a handle with owner and unshielded recipient address", async () => {
    await sim.register(NAME, NAME_BYTES, b32(2));
    const l = sim.ledger();
    expect(l.usernames.member(NAME)).toBe(true);
    expect(l.walletHandles.size()).toBe(1n);
    expect(l.handleNames.lookup(NAME)).toEqual(NAME_BYTES);
    expect(l.recipientAddresses.lookup(NAME)).toEqual(b32(2));
  });

  it("rejects a second handle for the same unshielded address", async () => {
    await sim.register(NAME, NAME_BYTES, b32(2));
    await expect(sim.register(hashName(OTHER_BYTES), OTHER_BYTES, b32(2))).rejects.toThrow("address already has a handle");
  });

  it("rejects a handle hash that does not match its display name", async () => {
    await expect(sim.register(hashName(OTHER_BYTES), NAME_BYTES, b32(2))).rejects.toThrow("handle hash does not match name");
  });

  it("rejects an empty recipient address", async () => {
    await expect(sim.register(NAME, NAME_BYTES, b32(0))).rejects.toThrow("invalid recipient address");
  });

  it("documents the unresolved forged-address attack that blocks deployment", async () => {
    // The circuit accepts an address supplied by any caller. This is an
    // exploit demonstration, not a security guarantee. Keep the deployment
    // gate until an in-circuit wallet ownership check makes this call fail.
    const victimAddress = b32(9);
    await sim.register(NAME, NAME_BYTES, victimAddress);
    expect(sim.ledger().walletHandles.lookup(victimAddress)).toEqual(NAME);
    await expect(sim.register(hashName(OTHER_BYTES), OTHER_BYTES, victimAddress))
      .rejects.toThrow("address already has a handle");
  });

  it("enforces handle uniqueness", async () => {
    await sim.register(NAME, NAME_BYTES, b32(2));
    await expect(sim.register(NAME, NAME_BYTES, b32(4))).rejects.toThrow();
  });
});
