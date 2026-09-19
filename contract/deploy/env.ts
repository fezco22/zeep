// Preprod EnvironmentConfiguration for ZEEP deploy.
// Endpoints from https://docs.midnight.network/guides/networks-and-environments
// Proof server runs locally (Docker: midnightnetwork/proof-server:8.1.0).
import type { EnvironmentConfiguration } from "@midnight-ntwrk/testkit-js";

export const preprodEnv = {
  walletNetworkId: "preprod",
  networkId: "preprod",
  indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  node: "https://rpc.preprod.midnight.network",
  nodeWS: "wss://rpc.preprod.midnight.network",
  faucet: "https://midnight-tmnight-preprod.nethermind.dev/",
  proofServer: process.env.PROOF_SERVER ?? "http://localhost:6300",
} as unknown as EnvironmentConfiguration;
