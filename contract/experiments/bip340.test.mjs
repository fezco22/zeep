import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  CompactTypeBytes,
  createConstructorContext,
  createCircuitContext,
  persistentHash,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  addressFromKey,
  signData,
  signingKeyFromBip340,
  signatureVerifyingKey,
} from "@midnight-ntwrk/ledger-v8";
import { Contract, ledger, pureCircuits } from "./managed-bip340/contract/index.js";

function lift(bytes) {
  const { x, y } = schnorr.utils.lift_x(BigInt("0x" + Buffer.from(bytes).toString("hex"))).toAffine();
  return { x, y, identity: false };
}

function fixture() {
  const secret = signingKeyFromBip340(new Uint8Array(32).fill(7));
  const verifyingKeyHex = signatureVerifyingKey(secret);
  const verifyingKey = Buffer.from(verifyingKeyHex, "hex");
  const message = createHash("sha256").update("zeep:test:preprod:handle:zeep").digest();
  const signature = Buffer.from(signData(secret, message), "hex");
  assert.equal(schnorr.verify(signature, createHash("sha256").update(message).digest(), verifyingKey), true);
  return {
    message,
    verifyingKey,
    signatureR: signature.subarray(0, 32),
    signatureS: signature.subarray(32),
    publicPoint: lift(verifyingKey),
    noncePoint: lift(signature.subarray(0, 32)),
    expectedAddress: addressFromKey(verifyingKeyHex),
  };
}

function verify(f) {
  return pureCircuits.verifyWalletSignature(
    f.message, f.verifyingKey, f.signatureR, f.signatureS, f.publicPoint, f.noncePoint, 7n,
  );
}

test("valid wallet BIP340 signature derives the corresponding unshielded address", () => {
  const f = fixture();
  assert.equal(Buffer.from(verify(f)).toString("hex"), f.expectedAddress);
});

test("changed message is rejected", () => {
  const f = fixture();
  const changed = { ...f, message: Buffer.from(f.message) };
  changed.message[0] ^= 1;
  assert.throws(() => verify(changed), /invalid wallet signature/);
});

test("forged public key is rejected", () => {
  const f = fixture();
  const forgedKey = Buffer.from(f.verifyingKey);
  forgedKey[0] ^= 1;
  assert.throws(() => verify({ ...f, verifyingKey: forgedKey }), /key mismatch/);
});

test("forged signature scalar is rejected", () => {
  const f = fixture();
  const forgedS = Buffer.from(f.signatureS);
  forgedS[0] ^= 1;
  assert.throws(() => verify({ ...f, signatureS: forgedS }), /invalid wallet signature/);
});

test("off-curve witness points and curve parameter are rejected", () => {
  const f = fixture();
  assert.throws(() => pureCircuits.verifyWalletSignature(
    f.message, f.verifyingKey, f.signatureR, f.signatureS,
    { ...f.publicPoint, y: f.publicPoint.y + 1n }, f.noncePoint, 7n,
  ), /public point not on curve/);
  assert.throws(() => pureCircuits.verifyWalletSignature(
    f.message, f.verifyingKey, f.signatureR, f.signatureS,
    f.publicPoint, { ...f.noncePoint, y: f.noncePoint.y + 1n }, 7n,
  ), /nonce point not on curve/);
  assert.throws(() => pureCircuits.verifyWalletSignature(
    f.message, f.verifyingKey, f.signatureR, f.signatureS,
    f.publicPoint, f.noncePoint, 8n,
  ), /invalid curve coefficient/);
});

const BYTES32 = new CompactTypeBytes(32);
const BYTES128 = new CompactTypeBytes(128);
const domain = Buffer.alloc(32);
domain.set(Buffer.from("ZEEP/register/v4/preprod"));

function handleBytes(name) {
  const out = Buffer.alloc(32);
  out.set(Buffer.from(name));
  return out;
}

function signedRegistration(contractAddress, name, secret, recipientAddress) {
  const nameBytes = handleBytes(name);
  const nameHash = Buffer.from(persistentHash(BYTES32, nameBytes));
  const message = Buffer.from(persistentHash(
    BYTES128,
    Buffer.concat([domain, Buffer.from(contractAddress, "hex"), nameHash, recipientAddress]),
  ));
  const verifyingKey = Buffer.from(signatureVerifyingKey(secret), "hex");
  const signature = Buffer.from(signData(secret, message), "hex");
  return [
    nameBytes,
    recipientAddress,
    verifyingKey,
    signature.subarray(0, 32),
    signature.subarray(32),
    lift(verifyingKey),
    lift(signature.subarray(0, 32)),
    7n,
  ];
}

async function registry() {
  const contract = new Contract({});
  const initialized = await contract.initialState(createConstructorContext({}, "0".repeat(64)));
  const address = sampleContractAddress();
  let state = initialized.currentContractState.data;
  let zswap = initialized.currentZswapLocalState;
  let privateState = initialized.currentPrivateState;
  return {
    address,
    ledger: () => ledger(state),
    async register(args) {
      const ctx = createCircuitContext("register", address, zswap, state, privateState);
      const result = await contract.circuits.register(ctx, ...args);
      state = result.context.callContext.currentQueryContext.state;
      zswap = result.context.callContext.currentZswapLocalState;
      privateState = result.context.callContext.currentPrivateState;
    },
  };
}

test("verified wallet registers once; forged recipient and replayed handle fail", async () => {
  const r = await registry();
  const owner = signingKeyFromBip340(new Uint8Array(32).fill(7));
  const attacker = signingKeyFromBip340(new Uint8Array(32).fill(9));
  const ownerAddress = Buffer.from(addressFromKey(signatureVerifyingKey(owner)), "hex");
  const attackerAddress = Buffer.from(addressFromKey(signatureVerifyingKey(attacker)), "hex");
  await assert.rejects(
    r.register(signedRegistration(r.address, "zeep", attacker, ownerAddress)),
    /wallet does not own recipient/,
  );
  await r.register(signedRegistration(r.address, "zeep", owner, ownerAddress));
  assert.equal(r.ledger().walletHandles.size(), 1n);
  await assert.rejects(
    r.register(signedRegistration(r.address, "second", owner, ownerAddress)),
    /wallet already has handle/,
  );
  await assert.rejects(
    r.register(signedRegistration(r.address, "zeep", attacker, attackerAddress)),
    /handle already registered/,
  );
});

test("a signature for another contract cannot register here", async () => {
  const r = await registry();
  const owner = signingKeyFromBip340(new Uint8Array(32).fill(7));
  const ownerAddress = Buffer.from(addressFromKey(signatureVerifyingKey(owner)), "hex");
  const otherContract = "f".repeat(64);
  await assert.rejects(
    r.register(signedRegistration(otherContract, "zeep", owner, ownerAddress)),
    /invalid wallet signature/,
  );
});
