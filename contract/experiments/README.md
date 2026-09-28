# BIP340 registration circuit experiment

This circuit targets Compact 0.34.0, ZKIR v3 and ledger 9. It is not wired
into the Preprod app, which currently uses ledger 8. See
`docs/REGISTRATION_AUTH.md` for the deployment gate.

From WSL, run in `contract/`:

```sh
compactc --feature-zkir-v3 --skip-zk experiments/bip340.compact experiments/managed-bip340
```

Then run in `contract/experiments/`:

```sh
npm ci
npm test
```

Omit `--skip-zk` and use `experiments/managed-bip340-proof` as the output
directory to generate proving and verifying keys. This can take several minutes
and produces a roughly 235 MB proving key. Generated files are ignored by Git.
