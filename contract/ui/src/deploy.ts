// Browser deploy of the ZEEP contract to Midnight Preprod via an injected
// DApp Connector wallet (1AM, Lace, ...). The wallet sponsors dust and proving,
// so the deploy pays zero gas -- this is the path that works on Preprod where the
// headless dust wallet cannot surface an accrued balance.
//
// Flow: detect window.midnight[*] -> connect('preprod') -> build midnight-js
// providers backed by the connected wallet -> deployContract(...) -> address.
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createUnprovenDeployTx, submitTxAsync } from "@midnight-ntwrk/midnight-js-contracts";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { Transaction } from "@midnight-ntwrk/ledger-v8";
import { CompiledZeepContract } from "../../deploy/compiled.js";
import type { ZeepPrivateState } from "../../src/witnesses.js";

const NETWORK_ID = "preprod";
const PRIVATE_STATE_ID = "zeepPrivateStateV3";
const CIRCUITS = ["register"] as const;
type ZeepCircuit = (typeof CIRCUITS)[number];

export type Wallet = { id: string; name: string; icon?: string; api: DAppConnectorWalletAPI };
export type Logger = (line: string) => void;

/** Enumerate injected Midnight wallets (window.midnight[<id>]). */
export function detectWallets(): Wallet[] {
  const injected = window.midnight ?? {};
  return Object.entries(injected)
    .filter(([, api]) => api && typeof api.connect === "function")
    .map(([id, api]) => ({ id, name: api.name ?? id, icon: api.icon, api }));
}

const toHex = (bytes: Uint8Array) => [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

/**
 * Deploy ZEEP through the given injected wallet. Returns the on-chain contract
 * address. `log` receives human-readable progress lines.
 */
export async function deployZeep(wallet: Wallet, log: Logger, connectedApi?: DAppConnectorConnectedAPI): Promise<string> {
  setNetworkId(NETWORK_ID);
  if (!connectedApi) log(`Connecting to ${wallet.name} on ${NETWORK_ID}...`);
  const api = connectedApi ?? await wallet.api.connect(NETWORK_ID);

  const status = await api.getConnectionStatus();
  log(`Connected. status.networkId=${String(status.networkId)}`);

  const config = await api.getConfiguration();
  log(`Wallet services: indexer=${config.indexerUri} prover=${config.proverServerUri}`);

  // V3 ZK assets are served statically under <base>/zk/zeep-v3. Resolve
  // against the app's base URL so it works at the domain
  // root and under a subpath (e.g. GitHub Pages' /zeep/).
  const zkBaseUrl = new URL(`${import.meta.env.BASE_URL}zk/zeep-v3`, window.location.href).href.replace(
    /\/$/,
    "",
  );
  const fetchZkArtifact = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    url.searchParams.set("v", "register-v3-6-inputs");
    return window.fetch(url, init);
  };
  const zkConfigProvider = new FetchZkConfigProvider<ZeepCircuit>(zkBaseUrl, fetchZkArtifact);

  // Delegate proving to the wallet, keyed by our served proving material.
  const provingProvider = await api.getProvingProvider(
    (zkConfigProvider as unknown as { asKeyMaterialProvider(): unknown }).asKeyMaterialProvider(),
  );
  const proofProvider = {
    async proveTx(unprovenTx: { prove(provider: unknown, costModel: unknown): Promise<unknown> }) {
      const { CostModel } = await import("@midnight-ntwrk/ledger-v8");
      return unprovenTx.prove(provingProvider, CostModel.initialCostModel());
    },
  };

  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);

  const privateStateProvider = levelPrivateStateProvider<typeof PRIVATE_STATE_ID, ZeepPrivateState>({
    privateStateStoreName: "zeep-private-state-v3",
    signingKeyStoreName: "zeep-deploy-signing-keys-v3",
    accountId: "zeep-deploy-preprod-v3",
    privateStoragePasswordProvider: () => "zeep-deploy-browser-store-2026!",
  });

  // The wallet holds the keys, balances the tx (dust in-wallet) and submits it.
  // WalletProvider.getCoinPublicKey/getEncryptionPublicKey are synchronous, so we
  // resolve them once up front and hand back the cached values.
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } = await api.getShieldedAddresses();

  const walletProvider = {
    getCoinPublicKey: () => shieldedCoinPublicKey as never,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey as never,
    balanceTx: async (tx: { serialize(): Uint8Array }): Promise<never> => {
      log("Balancing transaction in wallet (dust sponsored)...");
      const balanced = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
      if (!balanced?.tx) throw new Error("1AM wallet returned an empty balanced transaction.");
      return Transaction.deserialize("signature", "proof", "binding", fromHex(balanced.tx)) as never;
    },
  };

  const midnightProvider = {
    submitTx: async (tx: { serialize(): Uint8Array; identifiers(): string[] }): Promise<never> => {
      log("Submitting transaction via wallet...");
      await api.submitTransaction(toHex(tx.serialize()));
      const hash = tx.identifiers()[0];
      log(`Submitted: ${hash}`);
      return hash as never;
    },
  };

  const providers = {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };

  const initialPrivateState: ZeepPrivateState = {};

  log("Deploying ZEEP contract (proving + balancing may take a minute)...");
  const deployTxData = await createUnprovenDeployTx(providers as never, {
    compiledContract: CompiledZeepContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  } as never);

  const address = (deployTxData as { public: { contractAddress: string } }).public.contractAddress;
  log("Proving + submitting deploy transaction...");
  await submitTxAsync(providers as never, {
    unprovenTx: (deployTxData as { private: { unprovenTx: unknown } }).private.unprovenTx,
  } as never);
  log(`ZEEP deployed at: ${address}`);
  return address;
}
