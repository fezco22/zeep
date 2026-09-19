import { describe, it, expect } from "vitest";

// These tests target the compiled contract simulator. After `pnpm compile`
// generates managed/zeep, import the Contract + ledger constructor and drive
// register/pay/claim through the circuit runner.
//
// Scaffold assertions describe intended behavior (Level 3 needs >=3 passing).
// Replace the `it.todo`s with real simulator calls once managed/ exists.

describe("ZEEP contract", () => {
  it.todo("register binds a username to the receiver key");
  it.todo("pay inserts exactly one commitment and increments noteCount");
  it.todo("claim succeeds once, and a second claim of the same note fails on the nullifier");
  it.todo("pay writes no amount to any public ledger field");
});
