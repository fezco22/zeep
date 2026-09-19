// Witness implementations for ZEEP circuits.
// Wire these to the private state produced by `compact compile` (see managed/).
// Types below are placeholders until the contract is compiled and imports the
// generated Witnesses interface.

export type ZeepPrivateState = {
  receiverSk: Uint8Array;   // 32 bytes
  paymentSalt: Uint8Array;  // 32 bytes
  paymentAmount: bigint;    // Uint<64>
};

export const witnesses = {
  receiverSk: ({ privateState }: { privateState: ZeepPrivateState }) =>
    [privateState, privateState.receiverSk] as const,
  paymentSalt: ({ privateState }: { privateState: ZeepPrivateState }) =>
    [privateState, privateState.paymentSalt] as const,
  paymentAmount: ({ privateState }: { privateState: ZeepPrivateState }) =>
    [privateState, privateState.paymentAmount] as const,
};
