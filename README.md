# ZEEP

[![ci](https://github.com/fezco22/zeep/actions/workflows/ci.yml/badge.svg)](https://github.com/fezco22/zeep/actions/workflows/ci.yml)

Private payment rail on Midnight. Get paid by username, not by exposing your wallet.

Pay a `@username`; the receiver collects funds through unlinkable, zero-knowledge
payments. Built on Midnight with Compact. See [PRD_ZEEP.md](PRD_ZEEP.md) for the
full design.

## Idea (Level 1 seed)

Sharing a crypto address doxxes your whole financial history. ZEEP maps a public
`username -> receiver key` directory, records each payment as an opaque note
commitment (amount and sender stay private witnesses), and lets the receiver
claim via a nullifier that blocks double-claims. Selective disclosure lets a
receiver prove an aggregate (e.g. proof-of-income) without exposing any single
payment.

## Privacy model

- **Public:** that a payment happened, the note count, the username directory.
- **Private:** who paid, how much, which receiver a note belongs to, which note a
  claim spent. Sender, amount, and sender-receiver linkage are circuit witnesses.

## Layout

```
contract/          Compact contract + witnesses + tests
  src/zeep.compact register / pay / claim circuits
  src/witnesses.ts private-state witness impls
  test/            vitest suite (>=3 for Level 3)
.github/workflows/ CI: compile + test
PRD_ZEEP.md        full product spec
```

## Develop

```bash
cd contract
npm install
npm run compile   # compact compile -> managed/zeep
npm test
```

Requires the Midnight toolchain: compact compiler, proof server, Node 22, Docker.
Contract deploys to Preprod (Levels 1-5); Mainnet at Level 6.

## Usage

Three circuits drive the rail:

- **Register** `register(nameHash)` binds `hash(username)` to your receiver key. The
  directory entry is the only public part.
- **Pay** `pay(nameHash)` inserts an opaque note commitment. Amount and payer stay
  private witnesses; nothing links sender to receiver.
- **Claim** `claim(commitment)` proves you own the note and publishes a nullifier.
  A second claim of the same note is rejected.

Run the circuits locally through the simulator:

```bash
cd contract
npm install
npm run compile   # compact compile -> managed/zeep
npm test          # 4 tests: register / pay / claim / no-amount-on-ledger
```

## Links

- Product on X: TODO (add the profile URL once created)
- Preprod contract address: TODO (add after deploy)
- Live demo: TODO (add after frontend deploy)
