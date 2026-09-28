// Registration has no private witness inputs. An arbitrary witness is not a
// trustworthy way to identify the wallet that submitted a transaction.
export type ZeepPrivateState = Record<string, never>;

export const witnesses = {};
