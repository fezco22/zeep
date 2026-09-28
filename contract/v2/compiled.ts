import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import * as ZeepV2 from "./managed/zeep/contract/index.js";
import { v2Witnesses, type ZeepV2PrivateState } from "./witnesses.js";

export type ZeepV2Contract = ZeepV2.Contract<ZeepV2PrivateState>;

export const CompiledZeepV2Contract = CompiledContract.make<ZeepV2Contract>(
  "Zeep",
  ZeepV2.Contract as unknown as new (w: typeof v2Witnesses) => ZeepV2Contract,
).pipe(
  CompiledContract.withWitnesses(v2Witnesses),
  CompiledContract.withCompiledFileAssets("./v2/managed/zeep"),
);
