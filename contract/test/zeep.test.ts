import { describe, it, expect, beforeEach } from "vitest";
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, type Ledger } from "../managed/zeep/contract/index.js";
import { witnesses, type ZeepPrivateState } from "../src/witnesses.js";

const ZERO_CPK = "0".repeat(64);
const b32 = (fill: number) => new Uint8Array(32).fill(fill);

// Minimal in-process simulator for the ZEEP circuits. Threads contract state,
// private state and zswap state across calls; rebuilds a fresh circuit context
// per call with the correct circuitId.
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
    return new Sim(
      contract,
      sampleContractAddress(),
      c.currentPrivateState,
      c.currentContractState.data, // ChargedState
      c.currentZswapLocalState,
    );
  }

  private async call(id: "register" | "pay" | "claim", arg: Uint8Array) {
    // compact-runtime 0.16: createCircuitContext(address, zswap, contractState, privateState)
    const ctx = createCircuitContext(this.address, this.zswap, this.state, this.ps);
    const res = await this.contract.circuits[id](ctx as any, arg);
    this.state = res.context.currentQueryContext.state;
    this.ps = res.context.currentPrivateState as ZeepPrivateState;
    this.zswap = res.context.currentZswapLocalState;
    return res;
  }

  register(nameHash: Uint8Array) { return this.call("register", nameHash); }
  pay(nameHash: Uint8Array) { return this.call("pay", nameHash); }
  claim(commitment: Uint8Array) { return this.call("claim", commitment); }
  ledger(): Ledger { return ledger(this.state); }
  firstCommitment(): Uint8Array { return [...this.ledger().commitments][0]; }
}

const NAME = b32(7); // hash(username) stand-in

const PS: ZeepPrivateState = {
  receiverSk: b32(1),
  paymentSalt: b32(2),
  paymentAmount: 500n,
};

describe("ZEEP contract", () => {
  let sim: Sim;
  beforeEach(async () => { sim = await Sim.create(PS); });

  it("register binds a username to the receiver key", async () => {
    await sim.register(NAME);
    const l = sim.ledger();
    expect(l.usernames.member(NAME)).toBe(true);
    expect(l.usernames.size()).toBe(1n);
    expect(l.usernames.lookup(NAME).length).toBe(32);
  });

  it("pay inserts exactly one commitment and increments noteCount", async () => {
    await sim.register(NAME);
    await sim.pay(NAME);
    const l = sim.ledger();
    expect(l.commitments.size()).toBe(1n);
    expect(l.noteCount).toBe(1n);
  });

  it("claim succeeds once; a second claim of the same note fails on the nullifier", async () => {
    await sim.register(NAME);
    await sim.pay(NAME);
    const commitment = sim.firstCommitment();
    await sim.claim(commitment);
    expect(sim.ledger().nullifiers.size()).toBe(1n);
    await expect(sim.claim(commitment)).rejects.toThrow();
  });

  it("pay writes no amount to any public ledger field", async () => {
    await sim.register(NAME);
    await sim.pay(NAME);
    const l = sim.ledger();
    // Ledger exposes only the opaque sets + count; the amount never appears.
    expect(Object.keys(l as object)).toEqual(
      expect.arrayContaining(["usernames", "commitments", "nullifiers", "noteCount"]),
    );
    expect(Object.keys(l as object)).not.toContain("amount");
    expect(l.commitments.size()).toBe(1n);
  });
});
