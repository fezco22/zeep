/// <reference types="vite/client" />

// Midnight wallets inject their DApp Connector API under window.midnight[<walletId>].
// See @midnight-ntwrk/dapp-connector-api. We keep this loosely typed and narrow at
// the call sites in deploy.ts.
declare global {
  interface Window {
    midnight?: Record<string, DAppConnectorWalletAPI>;
  }
  interface DAppConnectorWalletAPI {
    name: string;
    icon?: string;
    apiVersion: string;
    connect(networkId: unknown): Promise<DAppConnectorConnectedAPI>;
    disconnect?(): Promise<void> | void;
  }
  interface DAppConnectorConnectedAPI {
    getConfiguration(): Promise<{
      indexerUri: string;
      indexerWsUri: string;
      proverServerUri: string;
      substrateNodeUri: string;
      networkId: unknown;
    }>;
    // Async: delegates proving to the wallet; resolves to a ledger ProvingProvider.
    getProvingProvider(keyMaterialProvider: unknown): Promise<unknown>;
    // Takes/returns a HEX-serialized transaction string.
    balanceUnsealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }>;
    balanceSealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }>;
    // Takes a HEX-serialized sealed transaction; resolves to void (relays it).
    submitTransaction(tx: string): Promise<void>;
    // Shielded keys are Bech32m; this is the correct source for coin/encryption keys.
    getShieldedAddresses(): Promise<{
      shieldedAddress: string;
      shieldedCoinPublicKey: string;
      shieldedEncryptionPublicKey: string;
    }>;
    getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
    // Shielded balances the wallet holds, keyed by token type (values are bigint-ish).
    getShieldedBalances(): Promise<Record<string, bigint>>;
    // Unshielded balances are also spendable by the wallet transfer builder and
    // are where faucet-funded tNIGHT commonly appears first.
    getUnshieldedBalances?(): Promise<Record<string, bigint>>;
    // Preprod transfers also need available DUST unless the wallet sponsors it.
    getDustBalance?(): Promise<bigint | { balance: bigint; cap: bigint }>;
    // Standard connectors return a HEX tx; 1AM 6.3.x submits during this call
    // and returns tx_id instead. Call submitTransaction only for the former.
    makeTransfer(
      outputs: { kind: "shielded" | "unshielded"; type: string; value: bigint; recipient: string }[],
      options?: { payFees?: boolean },
    ): Promise<{ tx: string } | { tx_id: string; txId?: string }>;
    makeIntent?(
      inputs: { kind: "shielded" | "unshielded"; type: string; value: bigint }[],
      outputs: { kind: "shielded" | "unshielded"; type: string; value: bigint; recipient: string }[],
      options: { intentId: number | "random"; payFees: boolean },
    ): Promise<{ tx: string }>;
    getConnectionStatus(): Promise<{ status: string; networkId?: unknown }>;
    signData(
      data: string,
      options: { encoding: "hex" | "base64" | "text"; keyType: "unshielded" },
    ): Promise<{ data: string; signature: string; verifyingKey: string }>;
  }
}

export {};
