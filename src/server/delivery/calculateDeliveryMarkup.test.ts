import { describe, expect, it } from "vitest";
import { calculateDeliveryMarkup } from "./calculateDeliveryMarkup";

describe("calculateDeliveryMarkup", () => {
  it("0% markup: buyer fee equals provider cost exactly", () => {
    const result = calculateDeliveryMarkup(5000, 0);
    expect(result).toEqual({ providerCostCents: 5000, markupPercentageBps: 0, markupAmountCents: 0, buyerFeeCents: 5000 });
  });

  it("5% markup", () => {
    const result = calculateDeliveryMarkup(5000, 500);
    expect(result.markupAmountCents).toBe(250);
    expect(result.buyerFeeCents).toBe(5250);
  });

  it("10% markup", () => {
    const result = calculateDeliveryMarkup(5000, 1000);
    expect(result.markupAmountCents).toBe(500);
    expect(result.buyerFeeCents).toBe(5500);
  });

  it("20% markup — the example from the phase brief: R50.00 provider cost -> R10.00 markup -> R60.00 buyer fee", () => {
    const result = calculateDeliveryMarkup(5000, 2000);
    expect(result.markupAmountCents).toBe(1000);
    expect(result.buyerFeeCents).toBe(6000);
  });

  it("handles a decimal-cents provider cost (e.g. R47.33) without floating-point drift", () => {
    const result = calculateDeliveryMarkup(4733, 1500);
    // 4733 * 1500 / 10000 = 709.95 -> rounds to 710
    expect(result.markupAmountCents).toBe(710);
    expect(result.buyerFeeCents).toBe(5443);
  });

  it("R0 provider cost (free collection) always produces R0 markup regardless of the configured rate", () => {
    const result = calculateDeliveryMarkup(0, 2000);
    expect(result.markupAmountCents).toBe(0);
    expect(result.buyerFeeCents).toBe(0);
  });

  it("100% markup (the hard ceiling) doubles the provider cost", () => {
    const result = calculateDeliveryMarkup(5000, 10000);
    expect(result.markupAmountCents).toBe(5000);
    expect(result.buyerFeeCents).toBe(10000);
  });

  it("is deterministic — repeated calls with the same inputs produce the same output", () => {
    const first = calculateDeliveryMarkup(4733, 1234);
    const second = calculateDeliveryMarkup(4733, 1234);
    expect(second).toEqual(first);
  });

  it("rejects a non-integer provider cost", () => {
    expect(() => calculateDeliveryMarkup(50.5, 1000)).toThrow();
  });

  it("rejects a negative provider cost", () => {
    expect(() => calculateDeliveryMarkup(-100, 1000)).toThrow();
  });

  it("rejects a markup percentage above 100%", () => {
    expect(() => calculateDeliveryMarkup(5000, 10001)).toThrow();
  });

  it("rejects a negative markup percentage", () => {
    expect(() => calculateDeliveryMarkup(5000, -1)).toThrow();
  });
});
