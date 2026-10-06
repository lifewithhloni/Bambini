import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectSignal extends Error {
  constructor(public target: string) {
    super("NEXT_REDIRECT");
  }
}
const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: rpcMock })) }));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { submitReview } = await import("./actions");

const ORDER = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
const USER = "0e0e0e0e-1111-4222-8333-444444444444";
const SECRET_COMMENT = "A-very-private-review-comment";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

let spies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  for (const m of [requireUserMock, rpcMock, revalidatePathMock]) m.mockReset();
  requireUserMock.mockResolvedValue({ id: USER });
  rpcMock.mockResolvedValue({ data: "review-id", error: null });
  spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
});

describe("submitReview", () => {
  it("requires a signed-in user, derived from the server session, before touching the database", async () => {
    requireUserMock.mockImplementation(() => {
      throw new RedirectSignal(`/login?next=/account/orders/${ORDER}`);
    });
    await expect(submitReview(ORDER, null, form({ rating: "5" }))).rejects.toThrow(RedirectSignal);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls create_review with exactly the order, rating and comment — no user id, no seller, nothing else", async () => {
    const result = await submitReview(ORDER, null, form({ rating: "4", comment: "  Good seller  " }));
    expect(result).toEqual({ success: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("create_review", { p_order_id: ORDER, p_rating: 4, p_comment: "Good seller" });
    expect(Object.keys(rpcMock.mock.calls[0][1]).sort()).toEqual(["p_comment", "p_order_id", "p_rating"]);
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain(USER);
  });

  it("ignores any reviewer/seller/business/product/seller_response/created_at/hidden_at a forged form carries", async () => {
    await submitReview(
      ORDER,
      null,
      form({
        rating: "5",
        reviewer_id: "attacker",
        seller_profile_id: "victim",
        business_id: "victim-biz",
        seller_type: "business",
        product_id: "other",
        seller_response: "fake",
        created_at: "2001-01-01",
        hidden_at: "2001-01-01",
        p_reviewer_id: "attacker",
      }),
    );
    const sent = JSON.stringify(rpcMock.mock.calls);
    for (const forged of ["attacker", "victim", "victim-biz", "other", "fake", "2001-01-01"]) expect(sent).not.toContain(forged);
    expect(rpcMock.mock.calls[0][1]).toEqual({ p_order_id: ORDER, p_rating: 5, p_comment: null });
  });

  it("a blank comment is sent as null", async () => {
    await submitReview(ORDER, null, form({ rating: "3", comment: "" }));
    expect(rpcMock.mock.calls[0][1].p_comment).toBeNull();
  });

  it("invalid input never reaches the database", async () => {
    const invalidForms: Record<string, string>[] = [{}, { rating: "0" }, { rating: "6" }, { rating: "4.5" }, { rating: "abc" }, { rating: "5", comment: "   " }, { rating: "5", comment: "x".repeat(1001) }];
    for (const fields of invalidForms) {
      const result = await submitReview(ORDER, null, form(fields));
      expect(result).toEqual({ error: expect.any(String) });
    }
    expect(await submitReview("not-a-uuid", null, form({ rating: "5" }))).toEqual({ error: "We couldn't find that order." });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("revalidates the order page on success only", async () => {
    await submitReview(ORDER, null, form({ rating: "5" }));
    expect(revalidatePathMock).toHaveBeenCalledWith(`/account/orders/${ORDER}`);
    revalidatePathMock.mockClear();
    rpcMock.mockResolvedValue({ data: null, error: { message: "Order has already been reviewed" } });
    await submitReview(ORDER, null, form({ rating: "5" }));
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Order not found", "We couldn't find that order."],
    ["Order is not completed", "You can review an order once it's completed."],
    ["Order has already been reviewed", "You've already reviewed this order."],
    ["Invalid rating", "Please choose a rating from 1 to 5 stars."],
    ["Invalid comment", "Your comment must be between 1 and 1000 characters."],
    ["Authentication required", "Please sign in to leave a review."],
  ])("maps the database error %j to a safe message", async (raw, friendly) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: raw } });
    expect(await submitReview(ORDER, null, form({ rating: "5" }))).toEqual({ error: friendly });
  });

  it("an unexpected database error becomes the generic message and logs one static line", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: `permission denied for table profiles (${SECRET_COMMENT}) ${ORDER} ${USER}` } });
    const result = await submitReview(ORDER, null, form({ rating: "5", comment: SECRET_COMMENT }));
    expect(result).toEqual({ error: "We couldn't save your review. Please try again." });
    expect(spies[3]).toHaveBeenCalledTimes(1); // console.error
    expect(spies[3]).toHaveBeenCalledWith("Review submission failed unexpectedly.");
  });

  it("never logs the comment, order id, or user id on any path", async () => {
    await submitReview(ORDER, null, form({ rating: "5", comment: SECRET_COMMENT }));
    rpcMock.mockResolvedValue({ data: null, error: { message: "Order has already been reviewed" } });
    await submitReview(ORDER, null, form({ rating: "5", comment: SECRET_COMMENT }));
    rpcMock.mockResolvedValue({ data: null, error: { message: `weird failure ${SECRET_COMMENT} ${ORDER} ${USER}` } });
    await submitReview(ORDER, null, form({ rating: "5", comment: SECRET_COMMENT }));
    await submitReview(ORDER, null, form({ rating: "9", comment: SECRET_COMMENT }));

    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const sensitive of [SECRET_COMMENT, ORDER, USER]) expect(logged).not.toContain(sensitive);
  });
});
