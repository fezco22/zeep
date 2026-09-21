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
  }
  interface DAppConnectorConnectedAPI {
    getConfiguration(): Promise<{
      indexerUri: string;
      indexerWsUri: string;
      proverServerUri: string;
      substrateNodeUri: string;
      networkId: unknown;
    }>;
    getProvingProvider(keyMaterialProvider: unknown): unknown;
    balanceUnsealedTransaction(tx: unknown): Promise<{ tx: unknown }>;
    balanceSealedTransaction(tx: unknown): Promise<{ tx: unknown }>;
    submitTransaction(tx: unknown): Promise<{ txHash: string } | string>;
    getCoinPublicKey?(): Promise<string>;
    getEncryptionPublicKey?(): Promise<string>;
    getShieldedAddresses?(): Promise<{ shieldedAddress: string }>;
    getUnshieldedAddress?(): Promise<string>;
    getConnectionStatus(): Promise<{ networkId: unknown; connected?: boolean }>;
  }
}

export {};
