// The connector's NIGHT transfer example uses 10_000_000 base units for 10 NIGHT.
export const TOKEN_SCALE = 1_000_000n;
const MAX_AMOUNT = (1n << 64n) - 1n;

export function parseTokenAmount(input: string): bigint {
  const value = input.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("Enter a valid amount with up to 6 decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * TOKEN_SCALE + BigInt(fraction.padEnd(6, "0") || "0");
  if (units <= 0n || units > MAX_AMOUNT) throw new Error("Amount must be greater than zero and fit in the token limit.");
  return units;
}

export function formatTokenAmount(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const fraction = (absolute % TOKEN_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${absolute / TOKEN_SCALE}${fraction ? `.${fraction}` : ""}`;
}
