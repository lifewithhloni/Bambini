import { describe, expect, it, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
vi.mock("@/server/auth/requireUser", () => ({ requireUser: requireUserMock }));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

class RedirectSignal extends Error {
  constructor(public target: string) {
    super("NEXT_REDIRECT");
  }
}
const redirectMock = vi.fn((target: string) => {
  throw new RedirectSignal(target);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

// --- A small reusable mock Supabase query builder -------------------------
// Each `.from(table)` call pops the next queued response for that table
// and returns a chainable object where every non-terminal method returns
// itself; the chain is also directly awaitable. This lets a single test
// script a sequence of calls (e.g. a SELECT to check ownership, then an
// UPDATE) without caring which exact methods were chained in between.
type QueuedResult = { data: unknown; error: unknown; count?: number };

function makeChain(result: QueuedResult) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.insert = vi.fn(self);
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.order = vi.fn(self);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (resolve: (v: QueuedResult) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function makeSupabaseMock() {
  const queues: Record<string, QueuedResult[]> = {};
  const fromCalls: string[] = [];
  const chains: Record<string, ReturnType<typeof makeChain>[]> = {};

  function queue(table: string, result: QueuedResult) {
    queues[table] ??= [];
    queues[table].push(result);
  }

  const uploadMock = vi.fn(async (_path: string, _file: File, _opts?: { contentType?: string }) => ({
    data: { path: "x" },
    error: null as { message: string } | null,
  }));
  const removeMock = vi.fn(async (_paths: string[]) => ({ data: null, error: null as { message: string } | null }));

  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const next = queues[table]?.shift() ?? { data: null, error: null };
      const chain = makeChain(next);
      chains[table] ??= [];
      chains[table].push(chain);
      return chain;
    }),
    storage: {
      from: vi.fn(() => ({ upload: uploadMock, remove: removeMock })),
    },
  };

  return { client, queue, fromCalls, chains, uploadMock, removeMock };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mockSupabase.client),
}));

let mockSupabase: ReturnType<typeof makeSupabaseMock>;

const {
  createListing,
  updateListing,
  changeListingStatus,
  deleteListing,
  addListingImages,
  removeListingImage,
} = await import("./actions");

function formData(fields: Record<string, string | File | undefined>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

function makeImageFile(name = "photo.png", type = "image/png", size = 1024) {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

const validListingFields = {
  title: "Baby Stroller",
  categoryId: "11111111-1111-4111-8111-111111111111",
  condition: "good",
  priceCents: "500",
  description: "Gently used",
  collectionAvailable: "on",
};

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
  revalidatePathMock.mockClear();
  redirectMock.mockClear();
  mockSupabase = makeSupabaseMock();
});

describe("createListing", () => {
  it("rejects invalid input before touching the database", async () => {
    const result = await createListing(null, formData({ ...validListingFields, title: "" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockSupabase.fromCalls).toEqual([]);
  });

  it("never trusts a client-supplied seller id — inserts with requireUser()'s id only", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });

    await expect(
      createListing(null, formData({ ...validListingFields, sellerId: "attacker-id" as unknown as string })),
    ).rejects.toThrow(RedirectSignal);

    const insertChain = mockSupabase.chains.products[0];
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ seller_profile_id: "user-1", status: "draft" }),
    );
    const insertedPayload = (insertChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedPayload).not.toHaveProperty("sellerId");
  });

  it("attaches the seller's own saved pickup location when collection is offered", async () => {
    mockSupabase.queue("profiles", { data: { location_id: "loc-1" }, error: null });
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await expect(
      createListing(null, formData({ ...validListingFields, collectionAvailable: "on" })),
    ).rejects.toThrow(RedirectSignal);
    const insertedPayload = (mockSupabase.chains.products[0].insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedPayload.pickup_location_id).toBe("loc-1");
  });

  it("attaches the seller's own saved pickup location for a delivery-only listing too (Phase 7A: a courier still needs a real pickup point)", async () => {
    mockSupabase.queue("profiles", { data: { location_id: "loc-1" }, error: null });
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await expect(
      createListing(
        null,
        formData({ ...validListingFields, collectionAvailable: undefined, deliveryAvailable: "on" }),
      ),
    ).rejects.toThrow(RedirectSignal);
    const insertedPayload = (mockSupabase.chains.products[0].insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedPayload.pickup_location_id).toBe("loc-1");
  });

  it("never resolves a pickup location for a business listing (no business location workflow yet)", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await expect(
      createListing(
        null,
        formData({
          ...validListingFields,
          sellerType: "business",
          businessId: "22222222-2222-4222-8222-222222222222",
        }),
      ),
    ).rejects.toThrow(RedirectSignal);
    const insertedPayload = (mockSupabase.chains.products[0].insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedPayload.pickup_location_id).toBeNull();
    expect(mockSupabase.fromCalls).not.toContain("profiles");
  });

  it("creates as a draft regardless of what the client sends", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await expect(createListing(null, formData(validListingFields))).rejects.toThrow(RedirectSignal);
    const insertedPayload = (mockSupabase.chains.products[0].insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertedPayload.status).toBe("draft");
  });

  it("redirects to the new listing's edit page on success", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await expect(createListing(null, formData(validListingFields))).rejects.toThrow(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/sell/listing-1/edit");
  });

  it("does not create a listing at all if an attached photo fails validation", async () => {
    const badFile = makeImageFile("evil.svg", "image/svg+xml");
    const result = await createListing(null, formData({ ...validListingFields, photos: badFile }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockSupabase.fromCalls).toEqual([]);
  });

  it("rejects more than the per-listing photo cap before creating anything", async () => {
    const fd = formData(validListingFields);
    for (let i = 0; i < 9; i++) fd.append("photos", makeImageFile(`p${i}.png`));
    const result = await createListing(null, fd);
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockSupabase.fromCalls).toEqual([]);
  });

  it("uploads valid photos and registers them after the listing is created", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    mockSupabase.queue("product_images", { data: { id: "img-1" }, error: null });

    const fd = formData(validListingFields);
    fd.append("photos", makeImageFile("a.png"));

    await expect(createListing(null, fd)).rejects.toThrow(RedirectSignal);

    expect(mockSupabase.uploadMock).toHaveBeenCalledTimes(1);
    const uploadPath = mockSupabase.uploadMock.mock.calls[0][0] as string;
    expect(uploadPath.startsWith("listing-1/")).toBe(true);
  });

  it("surfaces a generic error when the insert fails (e.g. business membership check denied by RLS)", async () => {
    mockSupabase.queue("products", { data: null, error: { message: "new row violates row-level security policy" } });
    const result = await createListing(null, formData({ ...validListingFields, sellerType: "business", businessId: "22222222-2222-4222-8222-222222222222" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect((result as { error: string }).error).not.toMatch(/row-level security/i);
  });
});

describe("updateListing", () => {
  it("rejects invalid input before touching the database", async () => {
    const result = await updateListing("listing-1", null, formData({ ...validListingFields, title: "" }));
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockSupabase.fromCalls).toEqual([]);
  });

  it("scopes both the seller_type lookup and the update itself to the given listing id via .eq()", async () => {
    mockSupabase.queue("products", { data: { seller_type: "parent" }, error: null });
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await updateListing("listing-1", null, formData(validListingFields));
    expect(mockSupabase.chains.products[0].eq).toHaveBeenCalledWith("id", "listing-1");
    expect(mockSupabase.chains.products[1].eq).toHaveBeenCalledWith("id", "listing-1");
  });

  it("reports 'not found' (not a silent success) when RLS filters out the row — not the seller's listing", async () => {
    mockSupabase.queue("products", { data: null, error: null }); // seller_type lookup finds nothing
    mockSupabase.queue("products", { data: null, error: null }); // update matches nothing either
    const result = await updateListing("someone-elses-listing", null, formData(validListingFields));
    expect(result).toEqual({ error: "Listing not found." });
  });

  it("refuses to edit a sold listing, without ever attempting the update", async () => {
    mockSupabase.queue("products", { data: { seller_type: "parent", status: "sold" }, error: null });
    const result = await updateListing("listing-1", null, formData(validListingFields));
    expect(result).toEqual({ error: expect.stringMatching(/sold/i) });
    expect(mockSupabase.fromCalls).toEqual(["products"]); // only the lookup — no update chain was created
  });

  it("never includes a seller/business/status field in the update payload", async () => {
    mockSupabase.queue("products", { data: { seller_type: "parent" }, error: null });
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await updateListing("listing-1", null, formData(validListingFields));
    const payload = (mockSupabase.chains.products[1].update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("seller_profile_id");
    expect(payload).not.toHaveProperty("business_id");
  });

  it("re-resolves pickup_location_id from the seller's own saved location on every edit, for a parent listing offering collection", async () => {
    mockSupabase.queue("products", { data: { seller_type: "parent" }, error: null });
    mockSupabase.queue("profiles", { data: { location_id: "loc-1" }, error: null });
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await updateListing("listing-1", null, formData({ ...validListingFields, collectionAvailable: "on" }));
    const payload = (mockSupabase.chains.products[1].update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.pickup_location_id).toBe("loc-1");
  });

  it("keeps resolving pickup_location_id when collection is toggled off but delivery stays on (Phase 7A)", async () => {
    mockSupabase.queue("products", { data: { seller_type: "parent" }, error: null });
    mockSupabase.queue("profiles", { data: { location_id: "loc-1" }, error: null });
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await updateListing(
      "listing-1",
      null,
      formData({ ...validListingFields, collectionAvailable: undefined, deliveryAvailable: "on" }),
    );
    const payload = (mockSupabase.chains.products[1].update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.pickup_location_id).toBe("loc-1");
  });

  it("never resolves a pickup location for a business listing (no business location workflow yet)", async () => {
    mockSupabase.queue("products", { data: { seller_type: "business" }, error: null });
    mockSupabase.queue("products", { data: { id: "listing-1" }, error: null });
    await updateListing("listing-1", null, formData(validListingFields));
    const payload = (mockSupabase.chains.products[1].update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.pickup_location_id).toBeNull();
    expect(mockSupabase.fromCalls).not.toContain("profiles");
  });
});

describe("changeListingStatus", () => {
  it("rejects a disallowed transition without ever calling update", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1", status: "archived" }, error: null });
    const result = await changeListingStatus("listing-1", "published");
    expect(result).toEqual({ error: expect.any(String) });
    // Only the initial SELECT happened — no update chain was created.
    expect(mockSupabase.fromCalls).toEqual(["products"]);
  });

  it("refuses to publish a listing with no photos", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1", status: "draft" }, error: null });
    mockSupabase.queue("product_images", { data: null, error: null, count: 0 });
    const result = await changeListingStatus("listing-1", "published");
    expect(result).toEqual({ error: expect.stringMatching(/photo/i) });
  });

  it("publishes a listing that has at least one photo, setting published_at", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1", status: "draft" }, error: null });
    mockSupabase.queue("product_images", { data: null, error: null, count: 1 });
    mockSupabase.queue("products", { data: null, error: null });

    const result = await changeListingStatus("listing-1", "published");
    expect(result).toEqual({ success: true });

    const updateChain = mockSupabase.chains.products[1];
    const payload = (updateChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.status).toBe("published");
    expect(payload.published_at).toBeDefined();
  });

  it("returns 'not found' for a listing that doesn't belong to the caller", async () => {
    mockSupabase.queue("products", { data: null, error: null });
    const result = await changeListingStatus("not-mine", "archived");
    expect(result).toEqual({ error: "Listing not found." });
  });

  it("safely rejects a legacy status value read back from the database, instead of crashing", async () => {
    // The Postgres enum still technically permits the foundation
    // phase's inert 'sold'/'removed' labels (see DECISIONS.md); nothing
    // in this app ever writes them, but this proves that if a row's
    // status were ever something other than draft/published/archived,
    // the action returns a clean error rather than throwing an
    // uncaught TypeError from statusTransitions.ts indexing an unknown
    // key.
    mockSupabase.queue("products", { data: { id: "listing-1", status: "sold" }, error: null });
    const result = await changeListingStatus("listing-1", "published");
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockSupabase.fromCalls).toEqual(["products"]);
  });

  it("also rejects an attempt to move a listing INTO a legacy status", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1", status: "draft" }, error: null });
    // "sold" isn't a real ListingStatus — cast simulates a caller that
    // bypassed TypeScript (e.g. a stale client build), which the
    // runtime check in statusTransitions.ts must still catch.
    const result = await changeListingStatus("listing-1", "sold" as Parameters<typeof changeListingStatus>[1]);
    expect(result).toEqual({ error: expect.any(String) });
    expect(mockSupabase.fromCalls).toEqual(["products"]);
  });
});

describe("deleteListing", () => {
  it("refuses to delete a published listing", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1", status: "published" }, error: null });
    const result = await deleteListing("listing-1");
    expect(result).toEqual({ error: expect.stringMatching(/archive/i) });
    expect(mockSupabase.fromCalls).toEqual(["products"]);
  });

  it("deletes a draft listing and its storage images", async () => {
    mockSupabase.queue("products", { data: { id: "listing-1", status: "draft" }, error: null });
    mockSupabase.queue("product_images", { data: [{ storage_path: "listing-1/a.png" }], error: null });
    mockSupabase.queue("products", { data: null, error: null });

    const result = await deleteListing("listing-1");
    expect(result).toEqual({ success: true });
    expect(mockSupabase.removeMock).toHaveBeenCalledWith(["listing-1/a.png"]);
  });
});

describe("addListingImages", () => {
  it("respects the existing image count when applying the cap", async () => {
    mockSupabase.queue("product_images", { data: null, error: null, count: 8 });
    const fd = new FormData();
    fd.append("photos", makeImageFile());
    const result = await addListingImages("listing-1", null, fd);
    expect(result).toEqual({ error: expect.stringMatching(/8 photos/i) });
  });

  it("requires at least one photo", async () => {
    mockSupabase.queue("product_images", { data: null, error: null, count: 0 });
    const result = await addListingImages("listing-1", null, new FormData());
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("removeListingImage", () => {
  it("returns 'not found' when RLS filters out the image (not the caller's)", async () => {
    mockSupabase.queue("product_images", { data: null, error: null });
    const result = await removeListingImage("img-1", "listing-1");
    expect(result).toEqual({ error: "Photo not found." });
  });

  it("deletes the DB row and the storage object", async () => {
    mockSupabase.queue("product_images", { data: { storage_path: "listing-1/a.png" }, error: null });
    mockSupabase.queue("product_images", { data: null, error: null });
    const result = await removeListingImage("img-1", "listing-1");
    expect(result).toEqual({ success: true });
    expect(mockSupabase.removeMock).toHaveBeenCalledWith(["listing-1/a.png"]);
  });
});
