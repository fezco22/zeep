# Two-wallet Preprod smoke test

The active local app uses the v3 directory at `5bc1b71c7246a21c5502ff673493a6d6beb9e31c1b18b0508efb9dfe556a6538`. It maps handles to unshielded receiving addresses. Native tNIGHT is public and is sent by the wallet. V2 handles must be registered again in v3. The v3 contract cannot prove the registrant owns the supplied address, so confirm a handle's address with its owner before paying.

1AM can approve a DApp before its wallet state is synced. ZEEP retries address reads for about three minutes without asking for a second approval. If 1AM remains unsynced, keep its extension open until it shows **Synced**, then press **Connect wallet** again. The DApp Connector's `getConnectionStatus()` reports connection and network, not wallet sync progress.

1. Connect recipient wallet A and register its handle in v3. Confirm its **unshielded** Preprod address from Settings begins `mn_addr_preprod1` and matches the handle lookup on-chain.
2. Connect funded payer wallet B in a separate browser profile. Open Send, enter A's handle and a small tNIGHT amount, then press Send to resolve it. Compare the displayed address with wallet A, check the confirmation box, and press Send again. Confirm the amount and address in 1AM before approving once.
3. Wait for the submitted transaction to confirm in the indexer. Verify the explorer's recipient output and amount, then check wallet A's unshielded balance after sync. A pending submission is not proof of payment.
4. Reconnect both wallets. Confirm wallet B's Activity shows the outbound transfer and wallet A's Activity shows the incoming transfer after network confirmation.

## Recorded result

The old `makeIntent` path produced a confirmed **self-transfer**. The attempted shielded `makeTransfer` path failed because tNIGHT is unshielded. The corrected V3 handle flow was used to send 100 tNIGHT from Zeep to Dori; the [Preprod transaction](https://explorer.1am.xyz/tx/2054f9abb2cd7e122e3816a63491b9b6b6d9e6dc2dd9649a3af20b517fa08223?network=preprod) is confirmed. The sender showed an outbound history item. The recipient's incoming history item was not visible in the initial report, so repeat step 4 before recording that UI behavior as verified.
