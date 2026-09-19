// Wrap the compiled ZEEP contract for midnight-js deployment.
// Mirrors the example-bboard contract/src/index.ts pattern (Apache-2.0).
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import * as Zeep from "../managed/zeep/contract/index.js";
import { witnesses, type ZeepPrivateState } from "../src/witnesses.js";

export type ZeepContract = Zeep.Contract<ZeepPrivateState>;

export const CompiledZeepContract = CompiledContract.make<ZeepContract>(
  "Zeep",
  Zeep.Contract as unknown as new (w: typeof witnesses) => ZeepContract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets("./managed/zeep"),
);
