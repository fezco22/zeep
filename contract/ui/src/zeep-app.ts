// ZEEP product logic: connect an injected Midnight wallet and drive the deployed
// contract's circuits (register / pay / claim) against the live Preprod address.
//
// Writes go through the low-level createUnprovenCallTx + submitTxAsync (the
// high-level callTx/deployContract wrappers block on publicDataProvider's
// finalization watch, which hangs on Preprod's flaky indexer WS).
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  createCallTxOptions,
  createUnprovenCallTx,
  submitTxAsync,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { createProofProvider } from "@midnight-ntwrk/midnight-js-types";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { ledger as decodeLedger } from "../../managed/zeep/contract/index.js";
import { CompiledZeepContract } from "../../deploy/compiled.js";
import type { ZeepPrivateState } from "../../src/witnesses.js";

export const NETWORK_ID = "preprod";
export const PRIVATE_STATE_ID = "zeepPrivateState";
export const CONTRACT_ADDRESS =
  "b9991bc137ebbea65a1129f375992a051b5fbd52c0e0508a1351e7030c54c0d5";
const CIRCUITS = ["register", "pay", "claim"] as const;
type ZeepCircuit = (typeof CIRCUITS)[number];

export type Wallet = { id: string; name: string; icon?: string; api: DAppConnectorWalletAPI };
export type Logger = (line: string) => void;

export type Session = {
  api: DAppConnectorConnectedAPI;
  providers: Record<string, unknown>;
  log: Logger;
};

export type ClaimCode = { commitment: string; amount: string; salt: string };

const enc = new TextEncoder();

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

const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): Uint8Array =>
  new Uint8Array((h.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));

/** hash(username) -> Bytes<32>. Both register and pay use this for the same handle. */
export async function nameHash(username: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(username.trim().toLowerCase()));
  return new Uint8Array(digest);
}

/** Per-browser receiver secret key (32 bytes), created once and persisted. */
export function receiverSk(): Uint8Array {
  try {
    const stored = localStorage.getItem("zeep.receiverSk");
    if (stored) return fromHex(stored);
  } catch {
    /* private mode: fall through to ephemeral key */
  }
  const sk = randomBytes(32);
  try {
    localStorage.setItem("zeep.receiverSk", toHex(sk));
  } catch {
    /* ignore */
  }
  return sk;
}

function txHashOf(result: { txHash: string } | string): string {
  return typeof result === "string" ? result : result.txHash;
}

/** Connect the wallet and assemble the midnight-js providers backed by it. */
export async function connect(wallet: Wallet, log: Logger): Promise<Session> {
  setNetworkId(NETWORK_ID);
  log(`Connecting to ${wallet.name} on ${NETWORK_ID}...`);
  const api = await wallet.api.connect(NETWORK_ID);
  const config = await api.getConfiguration();
  log(`Connected. indexer=${config.indexerUri}`);

  const zkBaseUrl = new URL(`${import.meta.env.BASE_URL}zk/zeep`, window.location.href).href.replace(
    /\/$/,
    "",
  );
  const zkConfigProvider = new FetchZkConfigProvider<ZeepCircuit>(zkBaseUrl, fetch.bind(window));
  const provingProvider = api.getProvingProvider(
    (zkConfigProvider as unknown as { asKeyMaterialProvider(): unknown }).asKeyMaterialProvider(),
  );
  const proofProvider = createProofProvider(provingProvider as never);
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const privateStateProvider = levelPrivateStateProvider<typeof PRIVATE_STATE_ID, ZeepPrivateState>({
    privateStateStoreName: "zeep-private-state",
  });

  const coinPublicKey = api.getCoinPublicKey ? await api.getCoinPublicKey() : "";
  const encryptionPublicKey = api.getEncryptionPublicKey ? await api.getEncryptionPublicKey() : "";
  const walletProvider = {
    getCoinPublicKey: () => coinPublicKey as never,
    getEncryptionPublicKey: () => encryptionPublicKey as never,
    balanceTx: async (tx: unknown) => (await api.balanceUnsealedTransaction(tx)).tx as never,
  };
  const midnightProvider = {
    submitTx: async (tx: unknown) => txHashOf(await api.submitTransaction(tx)) as never,
  };

  const providers = {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
  return { api, providers, log };
}

/** Set the private-state witnesses the next circuit call will read. */
async function setPrivateState(session: Session, ps: ZeepPrivateState): Promise<void> {
  await (
    session.providers.privateStateProvider as {
      set(id: string, ps: ZeepPrivateState): Promise<void>;
    }
  ).set(PRIVATE_STATE_ID, ps);
}

/** Submit a circuit call low-level; returns the tx id. */
async function callCircuit(
  session: Session,
  circuitId: ZeepCircuit,
  args: unknown[],
): Promise<string> {
  const opts = createCallTxOptions(
    CompiledZeepContract as never,
    circuitId as never,
    CONTRACT_ADDRESS as never,
    PRIVATE_STATE_ID as never,
    undefined as never,
    args as never,
  );
  const unproven = await createUnprovenCallTx(session.providers as never, opts as never);
  session.log(`Proving + submitting ${circuitId}...`);
  const txId = await submitTxAsync(session.providers as never, {
    unprovenTx: (unproven as { private: { unprovenTx: unknown } }).private.unprovenTx,
  } as never);
  session.log(`${circuitId} submitted: ${txId}`);
  return txId;
}

/** Read the contract's public ledger (usernames / commitments / nullifiers / noteCount). */
export async function readLedger(session: Session): Promise<{
  commitments: string[];
  noteCount: bigint;
  usernames: number;
}> {
  const state = await (
    session.providers.publicDataProvider as {
      queryContractState(addr: string): Promise<{ data: unknown } | null>;
    }
  ).queryContractState(CONTRACT_ADDRESS);
  if (!state) return { commitments: [], noteCount: 0n, usernames: 0 };
  const l = decodeLedger((state as { data: unknown }).data) as {
    commitments: Iterable<Uint8Array>;
    noteCount: bigint;
    usernames: { size(): bigint };
  };
  return {
    commitments: [...l.commitments].map(toHex),
    noteCount: l.noteCount,
    usernames: Number(l.usernames.size()),
  };
}

/** Register the caller's handle: usernames[hash(username)] = deriveKey(receiverSk). */
export async function register(session: Session, username: string): Promise<string> {
  await setPrivateState(session, {
    receiverSk: receiverSk(),
    paymentSalt: randomBytes(32),
    paymentAmount: 0n,
  });
  return callCircuit(session, "register", [await nameHash(username)]);
}

/** Pay a handle privately; returns a claim code the receiver redeems out-of-band. */
export async function pay(
  session: Session,
  username: string,
  amount: bigint,
): Promise<ClaimCode> {
  const salt = randomBytes(32);
  await setPrivateState(session, {
    receiverSk: randomBytes(32), // unused by `pay`, but the witness must resolve
    paymentSalt: salt,
    paymentAmount: amount,
  });
  const before = new Set((await readLedger(session)).commitments);
  await callCircuit(session, "pay", [await nameHash(username)]);
  const after = (await readLedger(session)).commitments;
  const commitment = after.find((c) => !before.has(c)) ?? after[after.length - 1] ?? "";
  return { commitment, amount: amount.toString(), salt: toHex(salt) };
}

/** Redeem a claim code: claim(commitment) with the receiver's private witnesses. */
export async function claim(session: Session, code: ClaimCode): Promise<string> {
  await setPrivateState(session, {
    receiverSk: receiverSk(),
    paymentSalt: fromHex(code.salt),
    paymentAmount: BigInt(code.amount),
  });
  return callCircuit(session, "claim", [fromHex(code.commitment)]);
}

export { toHex, fromHex };
