// Stable transaction submission that bypasses the wallet-sdk submission service.
//
// The SDK's PolkadotNodeClient submits via `api.tx.midnight.sendMnTransaction`
// and then tears down the connection in a `Stream.ensuring(api.disconnect())`
// block, which disconnects the WebSocket before the extrinsic is watched -- on
// Preprod this surfaces as `SubmissionError: disconnected ... Normal Closure`.
// Here we own the ApiPromise lifecycle and only disconnect after the tx is in a
// block, using the same unsigned `midnight.sendMnTransaction` call.
import { ApiPromise, WsProvider } from "@polkadot/api";
import { u8aToHex } from "@polkadot/util";
import { SerializedTransaction } from "@midnight-ntwrk/wallet-sdk-abstractions";

export function nodeWsUrl(nodeUrl: string): string {
  return nodeUrl.replace(/^http/, "ws");
}

export async function submitStable(
  nodeUrl: string,
  finalizedTx: unknown,
  waitFor: "InBlock" | "Finalized" = "InBlock",
): Promise<string> {
  const serialized = (SerializedTransaction as unknown as { from(tx: unknown): Uint8Array }).from(
    finalizedTx,
  );
  const api = await ApiPromise.create({
    provider: new WsProvider(nodeWsUrl(nodeUrl)),
    noInitWarn: true,
    throwOnConnect: true,
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      (api.tx as any).midnight
        .sendMnTransaction(u8aToHex(serialized))
        .send((result: any) => {
          if (result.isError) return reject(new Error("Transaction reported isError"));
          if (result.dispatchError) return reject(new Error(result.dispatchError.toString()));
          const done = waitFor === "Finalized" ? result.status?.isFinalized : result.status?.isInBlock;
          if (done) {
            const hash =
              result.status?.asInBlock?.toHex?.() ??
              result.txHash?.toHex?.() ??
              String(result.txHash);
            resolve(hash);
          }
        })
        .catch(reject);
    });
  } finally {
    await api.disconnect();
  }
}
