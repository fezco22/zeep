export type ZeepV2PrivateState = {
  ownerSecret: Uint8Array;
};

export const v2Witnesses = {
  ownerSecret: ({ privateState }: { privateState: ZeepV2PrivateState }) =>
    [privateState, privateState.ownerSecret] as [ZeepV2PrivateState, Uint8Array],
};
