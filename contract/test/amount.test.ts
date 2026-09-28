import { describe, expect, it } from "vitest";
import { formatTokenAmount, parseTokenAmount } from "../ui/src/amount.js";

describe("payment amount conversion", () => {
  it("sends the displayed amount in token base units", () => {
    expect(parseTokenAmount("10")).toBe(10_000_000n);
    expect(parseTokenAmount("0.000001")).toBe(1n);
    expect(formatTokenAmount(10_500_001n)).toBe("10.500001");
  });

  it("rejects a zero or over-precise amount", () => {
    expect(() => parseTokenAmount("0")).toThrow();
    expect(() => parseTokenAmount("1.0000001")).toThrow();
  });
});
