# ZEEP

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
