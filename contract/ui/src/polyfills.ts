// midnight-js packages (e.g. the indexer provider) call Node's global `Buffer`
// for hex (de)serialization, which the browser does not define. This module sets
// the global from the `buffer` shim and MUST be the first import in the entry so
// it runs before any midnight-js module evaluates.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
