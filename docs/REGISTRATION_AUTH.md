# Registration ownership gate

## Preprod demo decision (2026-09-29)

`contract/src/zeep.compact` may be deployed for the user-authorized Preprod
demo. Its
`register` circuit indexes the supplied unshielded receiving address, but does
not authenticate that the caller controls it. Anyone able to call the circuit
could register someone else's address. The browser's wallet check does not
protect direct contract calls. The user accepted this risk to enable handle
payments now. Do not present the directory as proof of wallet ownership or a
secure one-wallet-one-handle rule. Browser deployment with 1AM is enabled;
headless CLI deployment remains gated.
The v3 UI is enabled by default against the verified Preprod demo contract;
`VITE_ZEEP_V3_ADDRESS` can override its address for another deployment.
`@handle` resolves from the public
directory and 1AM makes an unshielded tNIGHT wallet transfer to the resolved
address. A Compact circuit cannot spend tNIGHT held by a user's wallet. The
UI asks the payer to verify the recipient mapping because a forged registration
is still possible. This is a demo payment flow with a known registration attack.

The live Preprod RPC `system_version` returned `1.0.300-20bb37c9` and
`state_getRuntimeVersion` returned spec version `1000300` on this date. The
[official node 1.0.300 release](https://github.com/midnightntwrk/midnight-node/releases/tag/node-1.0.300)
pins ledger 8.1.2. ZEEP's 1AM connector and SDK also use ledger 8. Compact
0.31.1 targets that ledger and does not provide the secp256k1 arithmetic needed
to verify the wallet's BIP340 signature in a circuit. `ownPublicKey()` is a
client witness, and `kernel.claimUnshieldedCoinSpend` does not expose the
signer of an unshielded input. Neither can substitute for wallet proof.

## Trustless circuit progress

`contract/experiments/bip340.compact` is a working **ledger 9 prototype**.
Compact 0.34.0 does provide secp256k1 types and operations when compiled with
`--feature-zkir-v3`; an earlier compiler check without this flag incorrectly
suggested that the operations were unavailable. The prototype verifies a 1AM
BIP340 signature in the circuit, derives the unshielded address from the
verifying key, binds the signature to the network, contract address, handle and
recipient address, and enforces one handle per authenticated wallet. Its tests
cover valid registration, forged addresses and signatures, off-curve witness
points, a second handle, a taken handle, and a signature replayed on another
contract. The generated proof materials target ledger 9 and **cannot be used
by the current ledger 8 Preprod wallet and chain**.

The v8 `signData` result signs `SHA256(message)` with BIP340; the prototype
accounts for this and its synthetic signatures were checked against the v8
ledger and an independent BIP340 implementation. It has not been connected to
the live 1AM registration flow or proven by a live network transaction.

## Release condition

For a secure release, wait for a compatible ledger 9 Preprod chain, 1AM
connector, proving service and Midnight JS stack, then integrate
the authenticated circuit and run an end-to-end test. A version number on the
node binary alone is insufficient: the on-chain runtime and wallet stack must
also support ledger 9. A trusted registrar is a different design and is not
the requested fully on-chain verification.

Old handles need no migration once the authenticated directory is deployed;
users can register again. `contract/test/zeep.test.ts` deliberately demonstrates
the unsafe v3 forged-address call and must stop succeeding before claiming
wallet ownership is proven on-chain.
