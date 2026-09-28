# ZEEP

[![CI](https://github.com/fezco22/zeep/actions/workflows/ci.yml/badge.svg)](https://github.com/fezco22/zeep/actions/workflows/ci.yml)

ZEEP runs a handle-to-unshielded-address directory on Midnight Preprod. The active app uses the [deployed v3 directory](contract/deploy/deployed.json). A payer enters `@handle`; the app resolves its receiving address on-chain and asks 1AM to send native tNIGHT there. Native tNIGHT payments are public. The recipient does not claim the payment through ZEEP.

## Current state

- The v3 directory is live at `5bc1b71c7246a21c5502ff673493a6d6beb9e31c1b18b0508efb9dfe556a6538`. Its deploy transaction confirmed in block `2750168`, and a read-only check matched its register verifier to local proving assets. The current directory has two registered handles. Handles from the prior [v2 directory](contract/v2/deployed.json) must be registered again in v3; v2 is no longer used by the app.
- Registration stores one handle per supplied unshielded address. The app checks that the connected 1AM wallet signed for that address.
- **The v3 contract cannot authenticate wallet ownership on-chain.** A direct contract caller can claim someone else's address. The user accepted this limitation for the Preprod demo; verify a handle's receiving address with its owner before paying. The one-wallet-one-handle rule holds in the app flow but is not a security guarantee of this deployed contract. See [registration design](docs/REGISTRATION_AUTH.md).
- The old payment implementation produced a confirmed self-transfer instead of paying `@dori`. The app no longer uses that route. V3 resolves handles to unshielded addresses and requests an unshielded wallet output. A two-wallet send of 100 tNIGHT from Zeep to Dori was confirmed on Preprod in [transaction `2054f9…08223`](https://explorer.1am.xyz/tx/2054f9abb2cd7e122e3816a63491b9b6b6d9e6dc2dd9649a3af20b517fa08223?network=preprod). For standard connectors, the app inspects the prepared output; 1AM submits during `makeTransfer`, so users must confirm the recipient and amount shown by 1AM. The recipient's incoming Activity entry still needs a fresh UI check.
- Activity is a browser-local presentation of submitted wallet actions. The directory and balances come from chain and wallet state; Activity is not a global transaction database. Shielded incoming payments cannot be fully reconstructed from the directory.

## Develop

The v3 contract in `contract/src` is the active Preprod demo. The contract provides handle lookup; the connected wallet moves tNIGHT. `VITE_ZEEP_USE_V2=1` selects the archived v2 directory for local comparison. `VITE_ZEEP_V3_ADDRESS` can override the v3 contract address for a separate deployment. Run `node verify-v3.mjs` from `contract/` to recheck the deployed state and verifier.

```bash
cd contract
npm install
npx fetch-compactc --version=0.31.1
npm run compile
npm run compile:v2
npm run build
npm test
node v2/verify-preprod.mjs

cd ui
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

The UI predev step copies v2 and v3 proving assets into separate directories. The contract compile step requires Compact compiler 0.31.1. The [Preprod test notes](docs/PREPROD_SMOKE_TEST.md) record the verified handle payment and the recipient-history check still to repeat.

## Links

- [Preprod v3 contract](https://explorer.1am.xyz/contract/5bc1b71c7246a21c5502ff673493a6d6beb9e31c1b18b0508efb9dfe556a6538?network=preprod)
- [Live demo](https://zeep-pink.vercel.app/)
- [Product on X](TODO: add product profile URL)
- [Product requirements](PRD_ZEEP.md)
- [Level 5 feedback and submission tracker](docs/LEVEL5_SUBMISSION.md)
