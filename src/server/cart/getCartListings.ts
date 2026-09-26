"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalUser } from "@/server/auth/requireUser";
import { getSignedImageUrls } from "@/server/listings/imageUrls";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 100; // mirrors cartStorage.ts's own MAX_CART_ITEMS — defensive, since these ids arrive from the client

export type CartLineStatus = "available" | "sold" | "unavailable" | "own_listing" | "deleted";

export type CartLine = {
  id: string;
  status: CartLineStatus;
  // Null only for status = "deleted" (the product row no longer
  // exists at all — nothing left to describe it with).
  title: string | null;
  priceCents: number | null;
  currency: string | null;
  condition: string | null;
  imageUrl: string | null;
  sellerName: string | null;
};

export type CartData = {
  lines: CartLine[];
  /** null = the viewer isn't signed in (verification isn't evaluated yet — that happens at /checkout, which requires sign-in first). */
  canTransact: boolean | null;
};

/**
 * The cart's only real logic: given a list of listing ids from the
 * buyer's own browser storage (never trusted for anything beyond "which
 * rows to look up"), re-fetch every field the cart page needs fresh
 * from the authoritative products table (plus profiles_public/
 * businesses_public for a display name) and classify each one's current
 * status. Nothing here is cached from add-to-cart time — a price
 * change, a sale, or an unpublish between "add" and "view cart" is
 * always reflected, never a stale snapshot.
 *
 * Never returns delivery fees, commission, or provider costs — this is
 * the same public-safe field set getPublicListing()/getCheckoutListing()
 * already use, not a new exposure surface.
 */
export async function getCartListings(rawIds: string[]): Promise<CartData> {
  const ids = Array.from(new Set(rawIds)).filter((id) => UUID_PATTERN.test(id)).slice(0, MAX_IDS);
  if (ids.length === 0) return { lines: [], canTransact: null };

  const supabase = await createClient();
  const viewer = await getOptionalUser();

  // products_select_active_or_owner_or_admin RLS only lets a plain
  // session see a 'published' row (or one it owns) — exactly what makes
  // a listing correctly disappear from public browsing once sold, but
  // it would ALSO make a since-sold/archived item vanish from its own
  // buyer's cart query, misreporting a real "sold"/"unavailable" item
  // as "deleted" (no row at all). The admin client is used for this one
  // read specifically to see the row regardless of status; nothing
  // beyond title/price/condition/status/seller identifiers is selected
  // (the same public-safe field set getPublicListing() already exposes
  // for any listing that was ever published), and every id being looked
  // up came from the caller's own cart — this never lets one buyer probe
  // an arbitrary id they have no prior relationship to, since the only
  // caller of this function is the cart page passing its own
  // localStorage contents.
  const adminSupabase = createAdminClient();

  const [{ data: products, error: productsError }, canTransactResult] = await Promise.all([
    adminSupabase
      .from("products")
      .select(
        "id, title, price_cents, currency, condition, status, seller_type, seller_profile_id, business_id, product_images(storage_path, sort_order)",
      )
      .in("id", ids),
    viewer ? supabase.rpc("can_transact") : Promise.resolve({ data: null }),
  ]);

  // A genuine fetch/connection failure here must never be mistaken for
  // "these listings don't exist" — supabase-js resolves a network error
  // as { data: null, error } rather than rejecting the promise, and
  // `products ?? []` would otherwise silently treat every single cart
  // line as "deleted" the moment the database is briefly unreachable,
  // which is a far more misleading message than a plain "couldn't load
  // your cart" the page can offer a retry for.
  if (productsError) {
    throw new Error(`Failed to load cart listings: ${productsError.message}`);
  }

  const productsById = new Map((products ?? []).map((p) => [p.id, p]));

  const coverPaths = (products ?? [])
    .map((p) => {
      const images = (p.product_images ?? []) as { storage_path: string; sort_order: number }[];
      return [...images].sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path ?? null;
    })
    .filter((p): p is string => !!p);
  const imageUrls = await getSignedImageUrls(coverPaths);

  const sellerProfileIds = Array.from(
    new Set((products ?? []).filter((p) => p.seller_type === "parent" && p.seller_profile_id).map((p) => p.seller_profile_id as string)),
  );
  const businessIds = Array.from(
    new Set((products ?? []).filter((p) => p.seller_type === "business" && p.business_id).map((p) => p.business_id as string)),
  );

  const [{ data: profiles }, { data: businesses }, ownedBusinessRows, memberBusinessRows] = await Promise.all([
    sellerProfileIds.length > 0 ? supabase.from("profiles_public").select("id, full_name").in("id", sellerProfileIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    businessIds.length > 0 ? supabase.from("businesses_public").select("id, business_name").in("id", businessIds) : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
    viewer && businessIds.length > 0 ? supabase.from("businesses").select("id").eq("owner_profile_id", viewer.id).in("id", businessIds) : Promise.resolve({ data: [] as { id: string }[] }),
    viewer && businessIds.length > 0 ? supabase.from("business_members").select("business_id").eq("profile_id", viewer.id).in("business_id", businessIds) : Promise.resolve({ data: [] as { business_id: string }[] }),
  ]);

  const nameByProfileId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const nameByBusinessId = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));
  // A viewer "owns" a business listing if they own the business outright
  // or are a staff member of it — the same two-source check
  // /sell/orders/[id]/page.tsx's own viewerIsOrderSeller() already uses,
  // reused here rather than re-derived differently.
  const ownedBusinessIds = new Set([...(ownedBusinessRows.data ?? []).map((b) => b.id), ...(memberBusinessRows.data ?? []).map((m) => m.business_id)]);

  const lines: CartLine[] = ids.map((id) => {
    const product = productsById.get(id);
    if (!product) {
      return { id, status: "deleted", title: null, priceCents: null, currency: null, condition: null, imageUrl: null, sellerName: null };
    }

    const isOwnListing = viewer
      ? (product.seller_type === "parent" && product.seller_profile_id === viewer.id) ||
        (product.seller_type === "business" && !!product.business_id && ownedBusinessIds.has(product.business_id))
      : false;

    let status: CartLineStatus;
    if (product.status === "sold") status = "sold";
    else if (product.status !== "published") status = "unavailable"; // draft or archived
    else if (isOwnListing) status = "own_listing";
    else status = "available";

    const images = (product.product_images ?? []) as { storage_path: string; sort_order: number }[];
    const coverPath = [...images].sort((a, b) => a.sort_order - b.sort_order)[0]?.storage_path ?? null;

    const sellerName =
      product.seller_type === "parent"
        ? (nameByProfileId.get(product.seller_profile_id ?? "") ?? null)
        : (nameByBusinessId.get(product.business_id ?? "") ?? null);

    return {
      id,
      status,
      title: product.title,
      priceCents: product.price_cents,
      currency: product.currency,
      condition: product.condition,
      imageUrl: coverPath ? (imageUrls[coverPath] ?? null) : null,
      sellerName,
    };
  });

  return { lines, canTransact: viewer ? canTransactResult.data === true : null };
}
