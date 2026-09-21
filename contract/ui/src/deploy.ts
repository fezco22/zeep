// Browser deploy of the ZEEP contract to Midnight Preprod via an injected
// DApp Connector wallet (1AM, Lace, ...). The wallet sponsors dust and proving,
// so the deploy pays zero gas -- this is the path that works on Preprod where the
// headless dust wallet cannot surface an accrued balance.
//
// Flow: detect window.midnight[*] -> connect('preprod') -> build midnight-js
// providers backed by the connected wallet -> deployContract(...) -> address.
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { createProofProvider } from "@midnight-ntwrk/midnight-js-types";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { CompiledZeepContract } from "../../deploy/compiled.js";
import type { ZeepPrivateState } from "../../src/witnesses.js";

const NETWORK_ID = "preprod";
const PRIVATE_STATE_ID = "zeepPrivateState";
const CIRCUITS = ["register", "pay", "claim"] as const;
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

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Normalize a wallet's submit result to a transaction id string. */
function txHashOf(result: { txHash: string } | string): string {
  return typeof result === "string" ? result : result.txHash;
}

/**
 * Deploy ZEEP through the given injected wallet. Returns the on-chain contract
 * address. `log` receives human-readable progress lines.
 */
export async function deployZeep(wallet: Wallet, log: Logger): Promise<string> {
  setNetworkId(NETWORK_ID);
  log(`Connecting to ${wallet.name} on ${NETWORK_ID}...`);
  const api = await wallet.api.connect(NETWORK_ID);

  const status = await api.getConnectionStatus();
  log(`Connected. status.networkId=${String(status.networkId)}`);

  const config = await api.getConfiguration();
  log(`Wallet services: indexer=${config.indexerUri} prover=${config.proverServerUri}`);

  // ZK assets are served statically from this app at /zk/zeep (see public/zk/zeep).
  const zkBaseUrl = `${window.location.origin}/zk/zeep`;
  const zkConfigProvider = new FetchZkConfigProvider<ZeepCircuit>(zkBaseUrl, fetch.bind(window));

  // Delegate proving to the wallet, keyed by our served proving material.
  const provingProvider = api.getProvingProvider(
    (zkConfigProvider as unknown as { asKeyMaterialProvider(): unknown }).asKeyMaterialProvider(),
  );
  const proofProvider = createProofProvider(provingProvider as never);

  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);

  const privateStateProvider = levelPrivateStateProvider<typeof PRIVATE_STATE_ID, ZeepPrivateState>({
    privateStateStoreName: "zeep-private-state",
  });

  // The wallet holds the keys, balances the tx (dust in-wallet) and submits it.
  // WalletProvider.getCoinPublicKey/getEncryptionPublicKey are synchronous, so we
  // resolve them once up front and hand back the cached values.
  const coinPublicKey = api.getCoinPublicKey ? await api.getCoinPublicKey() : "";
  const encryptionPublicKey = api.getEncryptionPublicKey ? await api.getEncryptionPublicKey() : "";

  const walletProvider = {
    getCoinPublicKey: () => coinPublicKey as never,
    getEncryptionPublicKey: () => encryptionPublicKey as never,
    balanceTx: async (tx: unknown): Promise<never> => {
      log("Balancing transaction in wallet (dust sponsored)...");
      const balanced = await api.balanceUnsealedTransaction(tx);
      return balanced.tx as never;
    },
  };

  const midnightProvider = {
    submitTx: async (tx: unknown): Promise<never> => {
      log("Submitting transaction via wallet...");
      const res = await api.submitTransaction(tx);
      const hash = txHashOf(res);
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

  const initialPrivateState: ZeepPrivateState = {
    receiverSk: randomBytes(32),
    paymentSalt: randomBytes(32),
    paymentAmount: 0n,
  };

  log("Deploying ZEEP contract (proving + balancing may take a minute)...");
  const deployed = await deployContract(providers as never, {
    compiledContract: CompiledZeepContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  } as never);

  const address = (deployed as { deployTxData: { public: { contractAddress: string } } }).deployTxData
    .public.contractAddress;
  log(`ZEEP deployed at: ${address}`);
  return address;
}
