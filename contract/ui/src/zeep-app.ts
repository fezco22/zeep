// ZEEP v2 directory: resolve a handle to its shielded recipient keys, then
// transfer tNIGHT through the connected wallet.
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createCallTxOptions, createUnprovenCallTx, submitTxAsync } from "@midnight-ntwrk/midnight-js-contracts";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { Transaction, addressFromKey } from "@midnight-ntwrk/ledger-v8";
import { persistentHash, CompactTypeBytes } from "@midnight-ntwrk/compact-runtime";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  UnshieldedAddress,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { ledger as decodeLedger } from "../../v2/managed/zeep/contract/index.js";
import { CompiledZeepV2Contract } from "../../v2/compiled.js";
import { ledger as decodeV3Ledger } from "../../managed/zeep/contract/index.js";
import { CompiledZeepContract } from "../../deploy/compiled.js";
import type { ZeepV2PrivateState } from "../../v2/witnesses.js";
import { waitForWalletAddresses } from "./wallet-ready.js";

export const NETWORK_ID = "preprod";
// The Preprod demo uses the deployed v3 handle-to-unshielded-address directory.
// Wallet ownership is checked by the UI but remains unenforced by the circuit.
const v3Address = import.meta.env.VITE_ZEEP_V3_ADDRESS?.trim() ?? "";
if (v3Address && !/^[0-9a-f]{64}$/i.test(v3Address)) {
  throw new Error("VITE_ZEEP_V3_ADDRESS must be a 64-character contract address.");
}
export const REGISTRY_VERSION: 2 | 3 = import.meta.env.VITE_ZEEP_USE_V2 === "1" ? 2 : 3;
// Versioned separately from the old v1/private-state namespace. A failed
// unfinalized call must never be resurrected by the browser's IndexedDB store.
export const PRIVATE_STATE_ID = REGISTRY_VERSION === 3 ? "zeepPrivateStateV3" : "zeepPrivateStateV2";
export const CONTRACT_ADDRESS = REGISTRY_VERSION === 3
  ? v3Address || "5bc1b71c7246a21c5502ff673493a6d6beb9e31c1b18b0508efb9dfe556a6538"
  : "10d4dee9b10adec9a98e409bd2abd509bbe34ac911d68a25f227cbc40b26f87f";
const CIRCUITS = ["register"] as const;
type ZeepCircuit = (typeof CIRCUITS)[number];

export type Wallet = { id: string; name: string; icon?: string; api: DAppConnectorWalletAPI };
export type Logger = (line: string) => void;
export type Session = {
  api: DAppConnectorConnectedAPI;
  providers: Record<string, unknown>;
  log: Logger;
  indexerWsUri: string;
  nativeTokenType: string;
  ownerSecret: Uint8Array;
  shieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
  unshieldedAddress: string;
};

export type FinalizedTransaction = {
  txHash: string;
  status: string;
  blockHeight?: number;
  blockTimestamp?: number;
};

let approvedConnection: { walletId: string; api: DAppConnectorConnectedAPI } | undefined;
export function forgetApprovedWalletConnection(): void { approvedConnection = undefined; }

const enc = new TextEncoder();
const BYTES32 = new CompactTypeBytes(32);
const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Uint8Array => {
  const raw = h.replace(/^0x/i, "");
  if (!/^(?:[0-9a-f]{2})*$/i.test(raw)) throw new Error("Wallet returned an invalid transaction encoding.");
  return new Uint8Array((raw.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
};

async function digest32(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

// Reproduces the identity used by the already-deployed v2 directory. The
// contract itself cannot authenticate this witness against a direct caller.
async function walletOwnerSecret(api: DAppConnectorConnectedAPI): Promise<Uint8Array> {
  const signature = await api.signData("ZEEP owner identity v2:preprod", { encoding: "text", keyType: "unshielded" });
  const stableKey = signature.verifyingKey || signature.signature;
  if (!stableKey) throw new Error("1AM did not return the wallet identity key.");
  return digest32(`zeep-owner-secret-v2:${stableKey}`);
}

function ownerIdLocal(secret: Uint8Array): Uint8Array {
  return persistentHash(BYTES32, secret) as Uint8Array;
}

/** Normalize a wallet/indexer transaction identifier without dropping its tag. */
export function normalizeTransactionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^0x/i, "");
  if (!raw) return null;
  return raw.toLowerCase();
}

/** Explorer links use the finalized transaction hash, not a tagged identifier. */
export function normalizeExplorerHash(value: unknown): string | null {
  const raw = normalizeTransactionId(value);
  if (!raw) return null;
  return /^00[0-9a-f]{64}$/i.test(raw) ? raw.slice(2).toLowerCase() : raw;
}

/**
 * Resolve a wallet submission identifier to the finalized transaction hash.
 * Wallet submission is asynchronous and its returned identifier is not always
 * the explorer hash. Never expose it as an explorer link until the indexer
 * returns finalized transaction data.
 */
export async function waitForFinalizedTx(
  session: Session,
  submissionId: string,
  timeoutMs = 90_000,
): Promise<FinalizedTransaction | null> {
  const provider = session.providers.publicDataProvider as {
    watchForTxData?: (txId: string) => Promise<{
      txHash?: unknown;
      status?: unknown;
      blockHeight?: number;
      blockTimestamp?: number;
    }>;
  };
  if (!provider.watchForTxData || !submissionId) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.watchForTxData(submissionId),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (!result || typeof result !== "object") return null;
    const txHash = normalizeExplorerHash(result.txHash);
    if (!txHash || !/^[0-9a-f]{64}$/i.test(txHash)) return null;
    return {
      txHash,
      status: String(result.status ?? "confirmed"),
      blockHeight: result.blockHeight,
      blockTimestamp: result.blockTimestamp,
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function detectWallets(): Wallet[] {
  const injected = window.midnight ?? {};
  return Object.entries(injected)
    .filter(([, api]) => api && typeof api.connect === "function")
    .map(([id, api]) => ({ id, name: api.name ?? id, icon: api.icon, api }));
}

export async function waitForWallets(): Promise<Wallet[]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const wallets = detectWallets();
    if (wallets.length) return wallets;
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
  }
  return [];
}

export async function nameHash(username: string): Promise<Uint8Array> {
  if (REGISTRY_VERSION === 3) return persistentHash(BYTES32, nameBytes(username)) as Uint8Array;
  return digest32(username.trim().toLowerCase());
}

/** Compact Bytes<32> representation of the display name (NUL padded). */
export function nameBytes(username: string): Uint8Array {
  const bytes = enc.encode(username.trim().toLowerCase());
  if (bytes.length > 32) throw new Error("Handle must be 32 bytes or shorter.");
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

function bytesToName(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\0+$/, "");
}

function addressKeyBytes(encoded: string, type: typeof ShieldedCoinPublicKey | typeof ShieldedEncryptionPublicKey): Uint8Array {
  const parsed = MidnightBech32m.parse(encoded);
  // Public-key classes expose their codec as `.codec` in address-format v3.
  // `MidnightBech32m.decode()` is reserved for classes with the instance
  // Bech32m symbol (such as ShieldedAddress), so calling it here leaves the
  // codec undefined and throws while registering a handle.
  const decoded = type.codec.decode(NETWORK_ID, parsed);
  return new Uint8Array(decoded.data);
}

function unshieldedAddressBytes(encoded: string): Uint8Array {
  return new Uint8Array(UnshieldedAddress.codec.decode(NETWORK_ID, MidnightBech32m.parse(encoded)).data);
}

function unshieldedAddressFromBytes(bytes: Uint8Array): string {
  return MidnightBech32m.encode(NETWORK_ID, new UnshieldedAddress(Buffer.from(bytes))).asString();
}

function addressFromKeys(coin: Uint8Array, encryption: Uint8Array): string {
  const coinKey = new ShieldedCoinPublicKey(Buffer.from(coin));
  const encryptionKey = new ShieldedEncryptionPublicKey(Buffer.from(encryption));
  return MidnightBech32m.encode(NETWORK_ID, new ShieldedAddress(coinKey, encryptionKey)).asString();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * A contract stores the verifier key that was compiled into it at deployment.
 * Submitting a proof made with a different local artifact always fails at the
 * node as `1010: Invalid Transaction: Custom error: 115` (InvalidProof).
 */
async function assertVerifierKeyMatches(
  publicDataProvider: unknown,
  zkConfigProvider: FetchZkConfigProvider<ZeepCircuit>,
): Promise<void> {
  const state = await (publicDataProvider as {
    queryContractState(addr: string): Promise<{
      operation?: (name: string) => { verifierKey?: Uint8Array };
    } | null>;
  }).queryContractState(CONTRACT_ADDRESS);
  const operation = state?.operation?.("register");
  const chainVerifier = operation?.verifierKey;
  if (!chainVerifier) throw new Error(`ZEEP v${REGISTRY_VERSION} directory is unavailable on Preprod.`);
  const localVerifier = await zkConfigProvider.getVerifierKey("register");
  if (!sameBytes(chainVerifier, localVerifier)) {
    throw new Error(
      `ZEEP v${REGISTRY_VERSION} verifier key does not match the deployed directory. Registration stopped before submitting a transaction.`,
    );
  }
}

/** Connect the wallet and assemble midnight-js providers backed by it. */
export async function connect(wallet: Wallet, log: Logger, onProgress?: (message: string) => void): Promise<Session> {
  setNetworkId(NETWORK_ID);
  onProgress?.("Waiting for wallet connection...");
  log(`Connecting to ${wallet.name} on ${NETWORK_ID}...`);
  let api = approvedConnection?.walletId === wallet.id ? approvedConnection.api : undefined;
  let networkChecked = false;
  if (api) {
    const status = await api.getConnectionStatus().catch(() => ({ status: "disconnected" as const }));
    if (status.status !== "connected") api = undefined;
    else if (status.networkId !== NETWORK_ID) {
      forgetApprovedWalletConnection();
      throw new Error(`1AM is connected to ${status.networkId}; switch it to ${NETWORK_ID} before continuing.`);
    } else networkChecked = true;
  }
  if (!api) {
    api = await wallet.api.connect(NETWORK_ID);
    approvedConnection = { walletId: wallet.id, api };
  }
  if (!networkChecked) {
    const status = await api.getConnectionStatus();
    if (status.status !== "connected" || status.networkId !== NETWORK_ID) {
      forgetApprovedWalletConnection();
      throw new Error(`Wallet connection is not active on ${NETWORK_ID}. Check the network selected in 1AM.`);
    }
  }
  const config = await api.getConfiguration();
  log(`Connected. indexer=${config.indexerUri}`);
  onProgress?.("Connection approved. Reading wallet addresses...");
  const { shielded: addresses, unshielded } = await waitForWalletAddresses(api, onProgress);
  onProgress?.(REGISTRY_VERSION === 2 ? "Confirm wallet identity in 1AM..." : "Checking wallet address...");
  const ownerSecret = REGISTRY_VERSION === 2
    ? await walletOwnerSecret(api)
    : unshieldedAddressBytes(unshielded.unshieldedAddress);
  onProgress?.("Preparing the app...");
  // Version every artifact request so a browser cannot reuse the old v1
  // register proving key after the contract schema changes.
  const zkBaseUrl = new URL(`${import.meta.env.BASE_URL}zk/${REGISTRY_VERSION === 3 ? "zeep-v3" : "zeep"}`, window.location.href).href.replace(/\/$/, "");
  const fetchZkArtifact = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    url.searchParams.set("v", REGISTRY_VERSION === 3 ? "register-v3-6-inputs" : "register-v2-8-inputs");
    return window.fetch(url, init);
  };
  const zkConfigProvider = new FetchZkConfigProvider<ZeepCircuit>(zkBaseUrl, fetchZkArtifact);
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  let provingProvider: Promise<unknown> | undefined;
  // 1AM's proving provider requires the ledger cost model to be passed to the
  // transaction's own `prove` method. The generic createProofProvider wrapper
  // omits that argument and can produce a transaction that the node rejects
  // during intent application (custom error 182).
  const proofProvider = {
    async proveTx(unprovenTx: { prove(provider: unknown, costModel: unknown): Promise<unknown> }) {
      const { CostModel } = await import("@midnight-ntwrk/ledger-v8");
      provingProvider ??= api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
      return unprovenTx.prove(await provingProvider, CostModel.initialCostModel());
    },
  };
  const privateStateProvider = levelPrivateStateProvider<typeof PRIVATE_STATE_ID, ZeepV2PrivateState>({
    privateStateStoreName: `zeep-private-state-v${REGISTRY_VERSION}`,
    signingKeyStoreName: `zeep-signing-keys-v${REGISTRY_VERSION}`,
    accountId: `zeep-preprod-v${REGISTRY_VERSION}`,
    privateStoragePasswordProvider: () => "zeep-preprod-app-store-2026!",
  });
  (privateStateProvider as unknown as { setContractAddress(a: string): void }).setContractAddress(CONTRACT_ADDRESS);
  const walletProvider = {
    getCoinPublicKey: () => addresses.shieldedCoinPublicKey as never,
    getEncryptionPublicKey: () => addresses.shieldedEncryptionPublicKey as never,
    balanceTx: async (tx: { serialize(): Uint8Array }) => {
      const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
      if (!balanced) throw new Error("1AM wallet returned an empty balanced transaction.");
      return Transaction.deserialize("signature", "proof", "binding", fromHex(balanced)) as never;
    },
  };
  const midnightProvider = {
    submitTx: async (tx: { serialize(): Uint8Array; identifiers(): string[] }) => {
      const submitted = (await api.submitTransaction(toHex(tx.serialize())) as unknown);
      const submittedId = normalizeTransactionId(submitted);
      if (submittedId) return submittedId as never;
      if (submitted && typeof submitted === "object") {
        const value = submitted as { transactionId?: unknown; id?: unknown };
        const objectId = normalizeTransactionId(value.transactionId) ?? normalizeTransactionId(value.id);
        if (objectId) return objectId as never;
      }
      return tx.identifiers()[0] as never;
    },
  };
  return {
    api,
    providers: { privateStateProvider, publicDataProvider, zkConfigProvider, proofProvider, walletProvider, midnightProvider },
    log,
    indexerWsUri: config.indexerWsUri,
    nativeTokenType: normalizeTokenType(unshieldedToken().raw)!,
    ownerSecret,
    shieldedAddress: addresses.shieldedAddress,
    shieldedCoinPublicKey: addresses.shieldedCoinPublicKey,
    shieldedEncryptionPublicKey: addresses.shieldedEncryptionPublicKey,
    unshieldedAddress: unshielded.unshieldedAddress,
  };
}

async function setPrivateState(session: Session, ps: ZeepV2PrivateState): Promise<void> {
  await (session.providers.privateStateProvider as { set(id: string, ps: ZeepV2PrivateState): Promise<void> }).set(PRIVATE_STATE_ID, ps);
}

async function callCircuit(session: Session, args: unknown[]): Promise<string> {
  const compiled = REGISTRY_VERSION === 3 ? CompiledZeepContract : CompiledZeepV2Contract;
  const opts = createCallTxOptions(compiled as never, "register" as never, CONTRACT_ADDRESS as never, PRIVATE_STATE_ID as never, undefined as never, args as never);
  const unproven = await createUnprovenCallTx(session.providers as never, opts as never);
  session.log("Proving + submitting register...");
  const txId = await submitTxAsync(session.providers as never, { unprovenTx: (unproven as { private: { unprovenTx: unknown } }).private.unprovenTx } as never);
  session.log(`register submitted: ${txId}`);
  return txId;
}

type RegistryLedger = {
  usernames: { size(): bigint; member(k: Uint8Array): boolean; lookup(k: Uint8Array): Uint8Array };
  walletHandles: { size(): bigint; member(k: Uint8Array): boolean; lookup(k: Uint8Array): Uint8Array };
  handleNames: { lookup(k: Uint8Array): Uint8Array };
  recipientCoins: { lookup(k: Uint8Array): Uint8Array };
  recipientEncryptions: { lookup(k: Uint8Array): Uint8Array };
  recipientAddresses?: { lookup(k: Uint8Array): Uint8Array };
};

export type IndexedUnshieldedTransaction = {
  txHash: string;
  status: string;
  blockTimestamp: number | null;
  createdUtxos: { owner: string; tokenType: string; value: string }[];
  spentUtxos: { owner: string; tokenType: string; value: string }[];
};

/** Stream the address's indexed unshielded history, then keep listening live. */
export function watchUnshieldedTransactions(
  session: Session,
  onTransaction: (transaction: IndexedUnshieldedTransaction) => void,
): () => void {
  let closedByApp = false;
  let subscribed = false;
  let socket: WebSocket;
  try {
    socket = new WebSocket(session.indexerWsUri, "graphql-transport-ws");
  } catch {
    session.log("Incoming activity is unavailable while the indexer is disconnected.");
    return () => {};
  }

  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "connection_init" })));
  socket.addEventListener("message", (message) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(message.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (payload.type === "connection_ack" && !subscribed) {
      subscribed = true;
      socket.send(JSON.stringify({
        id: "zeep-incoming-activity",
        type: "subscribe",
        payload: {
          query: `subscription($address: UnshieldedAddress!) {
            unshieldedTransactions(address: $address) {
              __typename
              ... on UnshieldedTransaction {
                transaction {
                  __typename
                  ... on RegularTransaction {
                    hash
                    transactionResult { status }
                    block { timestamp }
                  }
                }
                createdUtxos { owner tokenType value }
                spentUtxos { owner tokenType value }
              }
            }
          }`,
          variables: { address: session.unshieldedAddress },
        },
      }));
      return;
    }
    if (payload.id !== "zeep-incoming-activity" || payload.type !== "next") return;
    const data = payload.payload as { data?: { unshieldedTransactions?: unknown } } | undefined;
    const event = data?.data?.unshieldedTransactions as {
      __typename?: unknown;
      transaction?: {
        __typename?: unknown;
        hash?: unknown;
        transactionResult?: { status?: unknown };
        block?: { timestamp?: unknown };
      };
      createdUtxos?: unknown;
      spentUtxos?: unknown;
    } | undefined;
    if (event?.__typename !== "UnshieldedTransaction" || event.transaction?.__typename !== "RegularTransaction") return;
    const txHash = normalizeExplorerHash(event.transaction.hash);
    if (!txHash || !/^[0-9a-f]{64}$/i.test(txHash)) return;
    const parseUtxos = (value: unknown): IndexedUnshieldedTransaction["createdUtxos"] =>
      Array.isArray(value) ? value.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const utxo = item as { owner?: unknown; tokenType?: unknown; value?: unknown };
        if (typeof utxo.owner !== "string" || typeof utxo.tokenType !== "string" || typeof utxo.value !== "string") return [];
        return [{ owner: utxo.owner, tokenType: utxo.tokenType, value: utxo.value }];
      }) : [];
    const timestamp = event.transaction.block?.timestamp;
    onTransaction({
      txHash,
      status: String(event.transaction.transactionResult?.status ?? ""),
      blockTimestamp: typeof timestamp === "number" ? timestamp : null,
      createdUtxos: parseUtxos(event.createdUtxos),
      spentUtxos: parseUtxos(event.spentUtxos),
    });
  });
  socket.addEventListener("error", () => {
    if (!closedByApp) session.log("Incoming activity is temporarily unavailable from the indexer.");
  });

  return () => {
    closedByApp = true;
    try { socket.close(1000, "Wallet disconnected"); } catch { /* already closed */ }
  };
}

async function queryLedger(session: Session): Promise<RegistryLedger> {
  const state = await (session.providers.publicDataProvider as { queryContractState(addr: string): Promise<{ data: unknown } | null> }).queryContractState(CONTRACT_ADDRESS);
  if (!state) throw new Error(`The v${REGISTRY_VERSION} handle directory is unavailable on Preprod. Try again after the indexer reconnects.`);
  return (REGISTRY_VERSION === 3 ? decodeV3Ledger(state.data as never) : decodeLedger(state.data as never)) as unknown as RegistryLedger;
}

export async function readLedger(session: Session): Promise<{ commitments: string[]; noteCount: bigint; usernames: number }> {
  const ledger = await queryLedger(session);
  return { commitments: [], noteCount: 0n, usernames: Number(ledger.usernames.size()) };
}

export type HandleStatus = "free" | "mine" | "taken";
export async function handleStatus(session: Session, username: string): Promise<HandleStatus> {
  const ledger = await queryLedger(session);
  const hash = await nameHash(username);
  if (!ledger.usernames.member(hash)) return "free";
  const owner = REGISTRY_VERSION === 3 ? unshieldedAddressBytes(session.unshieldedAddress) : ownerIdLocal(session.ownerSecret);
  return toHex(ledger.usernames.lookup(hash)) === toHex(owner) ? "mine" : "taken";
}

/** Resolve the connected wallet's handle from the global directory. */
export async function registeredHandle(session: Session): Promise<string | null> {
  const ledger = await queryLedger(session);
  const owner = REGISTRY_VERSION === 3 ? unshieldedAddressBytes(session.unshieldedAddress) : ownerIdLocal(session.ownerSecret);
  if (!ledger.walletHandles.member(owner)) return null;
  const hash = ledger.walletHandles.lookup(owner);
  return bytesToName(ledger.handleNames.lookup(hash));
}

/** Resolve a handle to its on-chain payment address. */
export async function recipientAddress(session: Session, username: string): Promise<string | null> {
  const ledger = await queryLedger(session);
  const hash = await nameHash(username);
  if (!ledger.usernames.member(hash)) return null;
  if (REGISTRY_VERSION === 3) {
    if (!ledger.recipientAddresses) throw new Error("The v3 recipient map is missing from the deployed contract.");
    return unshieldedAddressFromBytes(ledger.recipientAddresses.lookup(hash));
  }
  return addressFromKeys(ledger.recipientCoins.lookup(hash), ledger.recipientEncryptions.lookup(hash));
}

export async function myUnshieldedAddress(session: Session): Promise<string> { return session.unshieldedAddress; }

function normalizeBalance(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === "object") {
    const candidate = (value as { value?: unknown; amount?: unknown; balance?: unknown }).value
      ?? (value as { amount?: unknown }).amount
      ?? (value as { balance?: unknown }).balance;
    return normalizeBalance(candidate);
  }
  return null;
}

function normalizeTokenType(value: unknown): string | null {
  if (typeof value === "string") return value.replace(/^0x/i, "").toLowerCase();
  if (value && typeof value === "object" && typeof (value as { raw?: unknown }).raw === "string") {
    return normalizeTokenType((value as { raw: string }).raw);
  }
  return null;
}

function balanceEntries(value: unknown): [unknown, unknown][] {
  // Wallet extensions can return a Map from a different JS realm, where
  // `instanceof Map` is false. The tag/entries checks keep that response
  // readable as well as the plain Record documented by the connector API.
  if (value instanceof Map || Object.prototype.toString.call(value) === "[object Map]") {
    const entries = (value as { entries?: () => Iterable<[unknown, unknown]> }).entries;
    if (typeof entries === "function") return [...entries.call(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (Array.isArray(entry) && entry.length >= 2) return [[entry[0], entry[1]]];
      if (entry && typeof entry === "object") {
        const row = entry as { tokenType?: unknown; type?: unknown; value?: unknown; amount?: unknown; balance?: unknown };
        const type = row.tokenType ?? row.type;
        const amount = row.value ?? row.amount ?? row.balance;
        return type !== undefined ? [[type, amount]] : [];
      }
      return [];
    });
  }
  if (value && typeof value === "object") {
    const nested = (value as { balances?: unknown }).balances;
    if (nested && nested !== value) return balanceEntries(nested);
    return Object.entries(value as Record<string, unknown>);
  }
  return [];
}

async function readBalanceSource(read: () => Promise<unknown>): Promise<[string, bigint][]> {
  // A failed read is not a zero balance. In particular, 1AM returns a sync
  // error after approval while its wallet state is not ready yet.
  const values = await read();
  return balanceEntries(values)
    .map(([type, value]) => [normalizeTokenType(type), normalizeBalance(value)] as [string | null, bigint | null])
    .filter((entry): entry is [string, bigint] => entry[1] !== null)
    .filter((entry): entry is [string, bigint] => entry[0] !== null)
    .filter(([, value]) => value > 0n);
}

export async function shieldedBalances(session: Session): Promise<[string, bigint][]> {
  return readBalanceSource(() => session.api.getShieldedBalances() as unknown as Promise<unknown>);
}

/** Read both balance surfaces. Faucet-funded tNIGHT can remain unshielded until
 * the first transfer, while the UI still needs to show the wallet's total. */
export async function walletBalances(session: Session): Promise<[string, bigint][]> {
  const shielded = await shieldedBalances(session);
  const unshielded = session.api.getUnshieldedBalances
    ? await readBalanceSource(() => session.api.getUnshieldedBalances!() as unknown as Promise<unknown>)
    : [];
  const totals = new Map<string, bigint>();
  for (const [type, value] of [...shielded, ...unshielded]) totals.set(type, (totals.get(type) ?? 0n) + value);
  return [...totals.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1));
}

export async function paymentBalance(session: Session): Promise<[string, bigint] | null> {
  return unshieldedPaymentBalance(session);
}

/** Native tNIGHT balance in the only pool that can hold this token. */
export async function unshieldedPaymentBalance(session: Session): Promise<[string, bigint] | null> {
  const funded = (session.api.getUnshieldedBalances
    ? await readBalanceSource(() => session.api.getUnshieldedBalances!() as unknown as Promise<unknown>)
    : []).filter(([, value]) => value > 0n);
  const nativeType = normalizeTokenType(unshieldedToken().raw)!;
  return funded.find(([type]) => type === nativeType) ?? null;
}

/** Read available fee DUST when the connected wallet exposes it. */
export async function walletDustBalance(session: Session): Promise<bigint | null> {
  if (!session.api.getDustBalance) return null;
  try {
    const result = await session.api.getDustBalance();
    if (typeof result === "bigint") return result;
    return normalizeBalance(result);
  } catch {
    return null;
  }
}

/** v2 only stores shielded keys, which cannot receive native tNIGHT. */
export async function sendToShielded(session: Session, toAddress: string, amount: bigint): Promise<string | null> {
  if (!/^mn_shield-addr_preprod1[023456789acdefghjklmnpqrstuvwxyz]+$/i.test(toAddress)) throw new Error("Invalid recipient shielded address for this network.");
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  void session;
  throw new Error("This handle only has a shielded address in the v2 directory. Native tNIGHT is unshielded, so it cannot be sent there. No transaction was created or submitted. ZEEP needs an on-chain unshielded recipient address for this handle.");
}

/** Send native tNIGHT directly to a user-supplied unshielded address. */
export async function sendToUnshielded(session: Session, toAddress: string, amount: bigint): Promise<string> {
  let recipient: UnshieldedAddress;
  try {
    recipient = UnshieldedAddress.codec.decode(NETWORK_ID, MidnightBech32m.parse(toAddress.trim()));
  } catch {
    throw new Error("Enter a valid Preprod unshielded address beginning mn_addr_preprod1.");
  }
  const canonicalAddress = MidnightBech32m.encode(NETWORK_ID, recipient).asString();
  if (canonicalAddress === session.unshieldedAddress) throw new Error("Recipient address is your own wallet. Choose the other person's address.");
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  const balance = await unshieldedPaymentBalance(session);
  if (!balance) throw new Error("1AM reports no spendable unshielded tNIGHT in this wallet.");
  if (balance[1] < amount) throw new Error("1AM reports less spendable unshielded tNIGHT than the requested amount.");

  const tokenType = normalizeTokenType(unshieldedToken().raw)!;
  const response = await session.api.makeTransfer([
    { kind: "unshielded", type: tokenType, value: amount, recipient: canonicalAddress },
  ], { payFees: true }) as unknown;
  if (!response || typeof response !== "object") {
    throw new Error("1AM returned no transfer result. Check its transaction history before attempting another payment.");
  }
  const result = response as { tx?: unknown; tx_id?: unknown; txId?: unknown; transactionId?: unknown };
  // 1AM 6.3.x submits inside makeTransfer and returns a transaction ID.
  // Do not pass that ID to submitTransaction a second time.
  const alreadySubmitted = normalizeTransactionId(result.tx_id)
    ?? normalizeTransactionId(result.txId)
    ?? normalizeTransactionId(result.transactionId);
  if (alreadySubmitted && /^(?:00)?[0-9a-f]{64}$/i.test(alreadySubmitted)) return alreadySubmitted;
  if (typeof result.tx !== "string") {
    throw new Error("Wallet transfer outcome is unclear. Check 1AM history before attempting another payment.");
  }

  // Other connector wallets follow the standard two-call API. Validate the
  // recipient output before submitting their prepared transaction.
  const prepared = Transaction.deserialize("signature", "proof", "binding", fromHex(result.tx));
  const owner = normalizeTokenType(recipient.hexString);
  const hasRecipientOutput = [...(prepared.intents?.values() ?? [])].some((intent) =>
    [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]
      .some((offer) => offer?.outputs.some((output) =>
        normalizeTokenType(output.owner) === owner
        && normalizeTokenType(output.type) === tokenType
        && output.value === amount,
      )),
  );
  if (!hasRecipientOutput) throw new Error("Wallet prepared no matching tNIGHT output for the recipient. Transfer cancelled before submission.");
  const preparedId = normalizeTransactionId(prepared.identifiers()[0]);
  if (!preparedId) throw new Error("Wallet prepared a transaction without an identifier. Transfer cancelled before submission.");
  const submitted = await session.api.submitTransaction(result.tx) as unknown;
  if (submitted && typeof submitted === "object") {
    const receipt = submitted as { tx_id?: unknown; txId?: unknown; transactionId?: unknown };
    return normalizeTransactionId(receipt.tx_id) ?? normalizeTransactionId(receipt.txId)
      ?? normalizeTransactionId(receipt.transactionId) ?? preparedId;
  }
  return normalizeTransactionId(submitted) ?? preparedId;
}

export async function register(session: Session, username: string): Promise<string> {
  await assertVerifierKeyMatches(
    session.providers.publicDataProvider,
    session.providers.zkConfigProvider as FetchZkConfigProvider<ZeepCircuit>,
  );
  if (REGISTRY_VERSION === 3) {
    // Client-side check for accidental wallet/address mismatch. Compact on
    // ledger 8 cannot enforce this signature in-circuit; this is not a
    // security boundary against direct contract callers.
    const signed = await session.api.signData("ZEEP register recipient v3:preprod", { encoding: "text", keyType: "unshielded" });
    const verifyingKey = normalizeTokenType(signed.verifyingKey);
    const address = unshieldedAddressBytes(session.unshieldedAddress);
    if (!verifyingKey || !/^[0-9a-f]{64}$/.test(verifyingKey)
      || normalizeTokenType(addressFromKey(verifyingKey)) !== toHex(address)) {
      throw new Error("1AM signature does not match the unshielded recipient address. Registration cancelled.");
    }
    await (session.providers.privateStateProvider as { set(id: string, ps: object): Promise<void> }).set(PRIVATE_STATE_ID, {});
    return callCircuit(session, [await nameHash(username), nameBytes(username), address]);
  }
  await setPrivateState(session, { ownerSecret: session.ownerSecret });
  return callCircuit(session, [
    await nameHash(username),
    nameBytes(username),
    addressKeyBytes(session.shieldedCoinPublicKey, ShieldedCoinPublicKey),
    addressKeyBytes(session.shieldedEncryptionPublicKey, ShieldedEncryptionPublicKey),
  ]);
}

export { toHex, fromHex };
