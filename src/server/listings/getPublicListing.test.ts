import { describe, expect, it, vi, beforeEach } from "vitest";

// The real `server-only` package throws when imported outside Next's
// bundler; imageUrls.ts and getMyListings.ts use it, so stub it for
// plain Vitest/Node the same way src/server/auth/requireUser.test.ts does.
vi.mock("server-only", () => ({}));

// --- A small reusable mock Supabase query builder, same pattern as
// actions.test.ts: each `.from(table)` call pops the next queued
// response for that table. The queued responses below encode what RLS
// (see tests/db/listings.test.ts for that proven separately against a
// real Postgres engine) would actually hand back to a given caller —
// this file's job is proving the APPLICATION CODE composes those
// results into the right authorization outcome, not re-proving RLS
// itself.
type QueuedResult = { data: unknown; error: unknown };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: QueuedResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function makeSupabaseMock() {
  const queues: Record<string, QueuedResult[]> = {};
  const fromCalls: string[] = [];

  function queue(table: string, result: QueuedResult) {
    queues[table] ??= [];
    queues[table].push(result);
  }

  const createSignedUrlsMock = vi.fn(
    async (
      _paths: string[],
      _expiresIn: number,
    ): Promise<{ data: { path: string; signedUrl: string | null; error: string | null }[] | null; error: unknown }> => ({
      data: [],
      error: null,
    }),
  );

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const next = queues[table]?.shift() ?? { data: null, error: null };
      return makeChain(next);
    }),
    storage: {
      from: vi.fn(() => ({ createSignedUrls: createSignedUrlsMock })),
    },
  };

  return { client, queue, fromCalls, createSignedUrlsMock };
}

let mockSupabase: ReturnType<typeof makeSupabaseMock>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));

const { getPublicListing } = await import("./getPublicListing");
const { getSignedImageUrls } = await import("./imageUrls");

beforeEach(() => {
  mockSupabase = makeSupabaseMock();
});

const PUBLISHED_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const ARCHIVED_ID = "33333333-3333-4333-8333-333333333333";

describe("getPublicListing — the public product-page authorization boundary", () => {
  it("returns a published listing's public-safe fields, including its image paths", async () => {
    mockSupabase.queue("products", {
      data: {
        id: PUBLISHED_ID,
        title: "Stroller",
        description: "Good condition",
        condition: "good",
        price_cents: 5000,
        currency: "ZAR",
        collection_available: true,
        delivery_available: false,
        seller_type: "parent",
        seller_profile_id: "seller-1",
        business_id: null,
        category_id: "cat-1",
        product_images: [
          { storage_path: `${PUBLISHED_ID}/b.jpg`, sort_order: 1 },
          { storage_path: `${PUBLISHED_ID}/a.jpg`, sort_order: 0 },
        ],
      },
      error: null,
    });
    mockSupabase.queue("categories", { data: { id: "cat-1", name: "Toys" }, error: null });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", {
      data: { full_name: "Alice", avatar_url: null, identity_verification: "verified", rating_average: 4.5, rating_count: 3 },
      error: null,
    });

    const listing = await getPublicListing(PUBLISHED_ID);

    expect(listing).not.toBeNull();
    expect(listing!.title).toBe("Stroller");
    // sorted by sort_order — proves the app doesn't just pass through raw order
    expect(listing!.images).toEqual([`${PUBLISHED_ID}/a.jpg`, `${PUBLISHED_ID}/b.jpg`]);
    expect(listing!.seller).toEqual({ name: "Alice", avatarUrl: null, isVerified: true, rating_average: 4.5, rating_count: 3 });
  });

  it("queries profiles_public for identity_verification, not account_verification — a parent seller's public badge means Bambini's identity check passed, never merely a confirmed email/phone", async () => {
    mockSupabase.queue("products", {
      data: {
        id: PUBLISHED_ID,
        title: "Stroller",
        description: null,
        condition: "good",
        price_cents: 5000,
        currency: "ZAR",
        collection_available: true,
        delivery_available: false,
        seller_type: "parent",
        seller_profile_id: "seller-1",
        business_id: null,
        category_id: "cat-1",
        product_images: [],
      },
      error: null,
    });
    mockSupabase.queue("categories", { data: null, error: null });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", {
      data: { full_name: "Alice", avatar_url: null, identity_verification: "pending", rating_average: null, rating_count: 0 },
      error: null,
    });

    const listing = await getPublicListing(PUBLISHED_ID);

    // account_verification is Phase 0 scaffolding, retained but never
    // read by anything authorization-relevant since Phase 5 (see
    // 20260928090000_identity_account_verification.sql) — this asserts
    // the actual SELECT never even names it, so a regression that
    // brings it back can't silently pass.
    const profilesPublicCallIndex = (mockSupabase.client.from as ReturnType<typeof vi.fn>).mock.calls.findIndex((call) => call[0] === "profiles_public");
    const profilesPublicChain = (mockSupabase.client.from as ReturnType<typeof vi.fn>).mock.results[profilesPublicCallIndex].value;
    expect(profilesPublicChain.select).toHaveBeenCalledWith(expect.stringContaining("identity_verification"));
    expect(profilesPublicChain.select).not.toHaveBeenCalledWith(expect.stringContaining("account_verification"));

    // A "pending" identity submission (e.g. confirmed email/phone but no
    // approved KYC yet) must never render as verified.
    expect(listing!.seller!.isVerified).toBe(false);
  });

  it("4. a business seller's badge follows businesses_public.verification_status — its own already-correct authoritative field, unchanged by this fix", async () => {
    mockSupabase.queue("products", {
      data: {
        id: PUBLISHED_ID,
        title: "Cot",
        description: null,
        condition: "good",
        price_cents: 20000,
        currency: "ZAR",
        collection_available: true,
        delivery_available: false,
        seller_type: "business",
        seller_profile_id: null,
        business_id: "biz-1",
        category_id: "cat-1",
        product_images: [],
      },
      error: null,
    });
    mockSupabase.queue("categories", { data: null, error: null });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("businesses_public", {
      data: { business_name: "Tiny Toes Co", logo_url: null, verification_status: "verified", rating_average: 4.8, rating_count: 12 },
      error: null,
    });

    const listing = await getPublicListing(PUBLISHED_ID);

    expect(listing!.seller).toEqual({ name: "Tiny Toes Co", avatarUrl: null, isVerified: true, rating_average: 4.8, rating_count: 12 });
  });

  it("an unverified/pending business never renders as verified", async () => {
    mockSupabase.queue("products", {
      data: {
        id: PUBLISHED_ID,
        title: "Cot",
        description: null,
        condition: "good",
        price_cents: 20000,
        currency: "ZAR",
        collection_available: true,
        delivery_available: false,
        seller_type: "business",
        seller_profile_id: null,
        business_id: "biz-2",
        category_id: "cat-1",
        product_images: [],
      },
      error: null,
    });
    mockSupabase.queue("categories", { data: null, error: null });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("businesses_public", {
      data: { business_name: "Unverified Co", logo_url: null, verification_status: "pending", rating_average: null, rating_count: 0 },
      error: null,
    });

    const listing = await getPublicListing(PUBLISHED_ID);

    expect(listing!.seller!.isVerified).toBe(false);
  });

  it("1. a draft listing cannot be retrieved — as an anonymous visitor would experience it", async () => {
    // Mirrors what RLS actually hands back for a draft to anon (proven
    // in tests/db/listings.test.ts): no row.
    mockSupabase.queue("products", { data: null, error: null });

    const listing = await getPublicListing(DRAFT_ID);

    expect(listing).toBeNull();
  });

  it("5. an archived listing cannot be exposed through the public listing path", async () => {
    mockSupabase.queue("products", { data: null, error: null });

    const listing = await getPublicListing(ARCHIVED_ID);

    expect(listing).toBeNull();
  });

  it("a nonexistent listing id returns the same null as a draft/archived one — no existence leak", async () => {
    mockSupabase.queue("products", { data: null, error: null });
    const listing = await getPublicListing("00000000-0000-4000-8000-000000000000");
    expect(listing).toBeNull();
  });

  it("always queries with an explicit status = 'published' filter — defense in depth alongside RLS, not a replacement for it", async () => {
    mockSupabase.queue("products", { data: null, error: null });
    await getPublicListing(DRAFT_ID);

    const productsChainCalls = (mockSupabase.client.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(productsChainCalls.eq).toHaveBeenCalledWith("status", "published");
  });
});

describe("2 & 4. getSignedImageUrls — never mints a URL Storage RLS would deny", () => {
  it("returns no URL for a draft listing's image when Storage denies it (simulating an unauthenticated caller)", async () => {
    const draftPath = `${DRAFT_ID}/secret.jpg`;
    mockSupabase.createSignedUrlsMock.mockResolvedValue({
      data: [{ path: draftPath, signedUrl: null, error: "Object not found" }],
      error: null,
    });

    const urls = await getSignedImageUrls([draftPath]);

    expect(urls).toEqual({});
  });

  it("returns no URL for another seller's draft/private listing image (simulating Seller A requesting Seller B's photo)", async () => {
    const sellerBsDraftPath = "seller-b-listing/private.jpg";
    mockSupabase.createSignedUrlsMock.mockResolvedValue({
      data: [{ path: sellerBsDraftPath, signedUrl: null, error: "Unauthorized" }],
      error: null,
    });

    const urls = await getSignedImageUrls([sellerBsDraftPath]);

    expect(urls).toEqual({});
  });

  it("in a mixed batch, only returns URLs for the paths Storage actually authorized — never fabricates the rest", async () => {
    const authorizedPath = `${PUBLISHED_ID}/a.jpg`;
    const deniedPath = `${DRAFT_ID}/b.jpg`;
    mockSupabase.createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: authorizedPath, signedUrl: "https://storage.example/signed/a", error: null },
        { path: deniedPath, signedUrl: null, error: "Unauthorized" },
      ],
      error: null,
    });

    const urls = await getSignedImageUrls([authorizedPath, deniedPath]);

    expect(urls).toEqual({ [authorizedPath]: "https://storage.example/signed/a" });
    expect(urls).not.toHaveProperty(deniedPath);
  });

  it("returns {} (not throw) if the whole batch call itself errors", async () => {
    mockSupabase.createSignedUrlsMock.mockResolvedValue({ data: null, error: { message: "network error" } });
    const urls = await getSignedImageUrls(["some/path.jpg"]);
    expect(urls).toEqual({});
  });

  it("returns {} for an empty path list without calling Storage at all", async () => {
    const urls = await getSignedImageUrls([]);
    expect(urls).toEqual({});
    expect(mockSupabase.createSignedUrlsMock).not.toHaveBeenCalled();
  });
});

describe("3. the full public-listing + image flow: published listings are authorized end to end, draft/archived never reach the image step", () => {
  it("published: getPublicListing succeeds, and its returned paths are exactly what's handed to getSignedImageUrls (the real page's own flow)", async () => {
    const imagePath = `${PUBLISHED_ID}/cover.jpg`;
    mockSupabase.queue("products", {
      data: {
        id: PUBLISHED_ID,
        title: "Stroller",
        description: null,
        condition: "good",
        price_cents: 5000,
        currency: "ZAR",
        collection_available: true,
        delivery_available: false,
        seller_type: "parent",
        seller_profile_id: "seller-1",
        business_id: null,
        category_id: "cat-1",
        product_images: [{ storage_path: imagePath, sort_order: 0 }],
      },
      error: null,
    });
    mockSupabase.queue("categories", { data: null, error: null });
    mockSupabase.queue("product_locations_public", { data: null, error: null });
    mockSupabase.queue("profiles_public", { data: null, error: null });
    mockSupabase.createSignedUrlsMock.mockResolvedValue({
      data: [{ path: imagePath, signedUrl: "https://storage.example/signed/cover", error: null }],
      error: null,
    });

    const listing = await getPublicListing(PUBLISHED_ID);
    expect(listing).not.toBeNull();

    // This is the exact call the real page (src/app/listings/[id]/page.tsx)
    // makes: getSignedImageUrls(listing.images) — never client-supplied
    // paths, always whatever the already-authorized listing returned.
    const urls = await getSignedImageUrls(listing!.images);
    expect(urls[imagePath]).toBe("https://storage.example/signed/cover");
  });

  it("draft: getPublicListing returns null, so a correctly-written caller never calls getSignedImageUrls at all", async () => {
    mockSupabase.queue("products", { data: null, error: null });

    const listing = await getPublicListing(DRAFT_ID);
    expect(listing).toBeNull();

    // The real page does `if (!listing) notFound()` here and returns —
    // it has no image paths to pass to getSignedImageUrls in the first
    // place, because they only ever come from a listing object, and
    // there isn't one. Storage was never even asked.
    expect(mockSupabase.createSignedUrlsMock).not.toHaveBeenCalled();
  });
});
