import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import wasm from "vite-plugin-wasm";

// The ZEEP deploy dApp imports the compiled contract from ../managed/zeep and
// witnesses from ../src, so Vite needs filesystem access to the contract root.
// Midnight's runtime packages ship WASM (vite-plugin-wasm) and use top-level
// await, which the `esnext` target supports natively -- so no TLA plugin is
// needed (it also breaks the production build via an swc `missing field type`
// bug). `global: globalThis` satisfies libraries that expect a Node global.
export default defineConfig({
  // Relative base so the build works both at the domain root (local preview) and
  // under a subpath like GitHub Pages' /zeep/.
  base: "./",
  plugins: [wasm()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      // isomorphic-ws' browser build has no named `WebSocket` export, but the
      // indexer provider imports it by name. Point it at a shim that re-exports
      // the browser's global WebSocket as both default and named.
      "isomorphic-ws": fileURLToPath(new URL("./src/isomorphic-ws-shim.ts", import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
  optimizeDeps: {
    exclude: [
      "@midnight-ntwrk/compact-runtime",
      "@midnight-ntwrk/onchain-runtime-v3",
      "@midnight-ntwrk/midnight-js-contracts",
    ],
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    target: "esnext",
  },
});
