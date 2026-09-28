import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const captureException = vi.fn();
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException, captureMessage }));

const { reportOperationalFailure } = await import("./reportOperationalFailure");

beforeEach(() => {
  captureException.mockReset();
  captureMessage.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reportOperationalFailure", () => {
  it("routes a real Error to captureException, tagged with its area", () => {
    const err = new Error("boom");
    reportOperationalFailure({ area: "payfast_webhook", orderId: "order-1", reason: "webhook handler threw" }, err);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureMessage).not.toHaveBeenCalled();
    const [reportedErr, scope] = captureException.mock.calls[0];
    expect(reportedErr).toBe(err);
    expect(scope.tags.area).toBe("payfast_webhook");
  });

  it("routes a non-exception failure (a rejected/failed outcome, not a thrown error) to captureMessage", () => {
    reportOperationalFailure({ area: "payout", payoutId: "payout-1", reason: "unrecognized payout error: xyz" });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage.mock.calls[0][0]).toBe("unrecognized payout error: xyz");
  });

  it("never throws itself, even if the Sentry SDK call throws — a monitoring failure cannot abort the caller's own financial operation", () => {
    captureException.mockImplementation(() => {
      throw new Error("Sentry SDK exploded");
    });
    expect(() => reportOperationalFailure({ area: "delivery_booking", orderId: "order-1", reason: "x" }, new Error("y"))).not.toThrow();

    captureMessage.mockImplementation(() => {
      throw new Error("Sentry SDK exploded");
    });
    expect(() => reportOperationalFailure({ area: "payout", reason: "x" })).not.toThrow();
  });

  it("only ever forwards the caller-supplied area/orderId/payoutId/reason — never any other field, so a caller cannot smuggle a message body, SA ID, document path, address, or secret into the scope by construction", () => {
    reportOperationalFailure({ area: "payout", payoutId: "payout-1", reason: "test" }, new Error("x"));
    const scope = captureException.mock.calls[0][1];
    expect(Object.keys(scope)).toEqual(["tags", "extra"]);
    expect(Object.keys(scope.tags)).toEqual(["area"]);
    expect(Object.keys(scope.extra).sort()).toEqual(["orderId", "payoutId", "reason"]);
  });
});
