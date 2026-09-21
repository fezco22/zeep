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
  const provider = new WsProvider(nodeWsUrl(nodeUrl));
  const api = await ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true });
  // The relay WS can close ("Normal Closure") before the extrinsic is included,
  // which kills the status subscription and would otherwise hang forever. Bound
  // the wait with a timeout and reject on disconnect so the caller can rebuild
  // and resubmit.
  const timeoutMs = Number(process.env.SUBMIT_TIMEOUT_MS ?? 90_000);
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (fn: (v: any) => void, v: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(v);
      };
      timer = setTimeout(
        () => finish(reject, new Error(`submit timeout after ${timeoutMs}ms (no ${waitFor})`)),
        timeoutMs,
      );
      provider.on("disconnected", () =>
        finish(reject, new Error("node WS disconnected before inclusion")),
      );
      (api.tx as any).midnight
        .sendMnTransaction(u8aToHex(serialized))
        .send((result: any) => {
          if (result.isError) return finish(reject, new Error("Transaction reported isError"));
          if (result.dispatchError) return finish(reject, new Error(result.dispatchError.toString()));
          const ok = waitFor === "Finalized" ? result.status?.isFinalized : result.status?.isInBlock;
          if (ok) {
            const hash =
              result.status?.asInBlock?.toHex?.() ??
              result.txHash?.toHex?.() ??
              String(result.txHash);
            finish(resolve, hash);
          }
        })
        .catch((e: unknown) => finish(reject, e));
    });
  } finally {
    await api.disconnect();
  }
}
