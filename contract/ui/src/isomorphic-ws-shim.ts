// Shim for `isomorphic-ws` in the browser. Its browser build exports the global
// WebSocket only as a default, but @midnight-ntwrk/midnight-js-indexer-public-data-provider
// imports it by name (`import { WebSocket } from "isomorphic-ws"`). Re-export the
// browser's native WebSocket as both default and named so either import works.
const WS = globalThis.WebSocket;
export default WS;
export { WS as WebSocket };
