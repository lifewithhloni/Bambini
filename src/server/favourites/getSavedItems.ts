import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifySavedItem, savedItemShowsDetails, type SavedItemStatus } from "@/lib/favourites/savedItemStatus";
import type { ListingSummary } from "@/server/search/searchListings";

export type SavedItem = {
  productId: string;
  savedAt: string;
  status: SavedItemStatus;
  /** Present only when status is "available" or "sold" — see savedItemShowsDetails(). Always the product's CURRENT data. */
  listing: (ListingSummary & { sellerName: string | null }) | null;
};

/**
 * The saved-items read: the caller's own product_favourites rows (owner
 * RLS — the explicit profile_id filter is defense in depth), then the
 * current product data for exactly those ids.
 *
 * products RLS only lets a non-owner see PUBLISHED rows, which would make
 * a since-sold listing look "deleted" in its own saver's list (the same
 * gap getCartListings()/getOrder() found), so the current-state read
 * uses the admin client — narrowly: the ids come only from this user's
 * own favourites rows, and details are returned only for published/sold
 * products (see classifySavedItem()); an archived/draft/missing product
 * yields a details-free stub, so this can never surface unpublished
 * content or confirm what a guessed id is. Prices/titles are fetched
 * fresh on every load, never cached at save time.
 */
export async function getSavedItems(userId: string): Promise<SavedItem[]> {
  const supabase = await createClient();

  const { data: favourites, error } = await supabase
    .from("product_favourites")
    .select("product_id, created_at")
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load saved items: ${error.message}`);
  if (!favourites || favourites.length === 0) return [];

  const ids = favourites.map((f) => f.product_id);

  const { data: products, error: productsError } = await createAdminClient()
    .from("products")
    .select(
      "id, title, price_cents, currency, condition, category_id, collection_available, delivery_available, created_at, status, seller_type, seller_profile_id, business_id, product_images(storage_path, sort_order)",
    )
    .in("id", ids);
  if (productsError) throw new Error(`Failed to load saved items: ${productsError.message}`);

  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  const visible = (products ?? []).filter((p) => savedItemShowsDetails(classifySavedItem(p)));
  const parentIds = Array.from(new Set(visible.filter((p) => p.seller_type === "parent" && p.seller_profile_id).map((p) => p.seller_profile_id as string)));
  const businessIds = Array.from(new Set(visible.filter((p) => p.seller_type === "business" && p.business_id).map((p) => p.business_id as string)));

  const [{ data: profiles }, { data: businesses }] = await Promise.all([
    parentIds.length > 0 ? supabase.from("profiles_public").select("id, full_name").in("id", parentIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    businessIds.length > 0
      ? supabase.from("businesses_public").select("id, business_name").in("id", businessIds)
      : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
  ]);
  const nameByProfile = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const nameByBusiness = new Map((businesses ?? []).map((b) => [b.id, b.business_name]));

  return favourites.map((fav) => {
    const product = productById.get(fav.product_id);
    const status = classifySavedItem(product);
    if (!product || !savedItemShowsDetails(status)) {
      return { productId: fav.product_id, savedAt: fav.created_at, status, listing: null };
    }

    const images = (product.product_images ?? []) as { storage_path: string; sort_order: number }[];
    const cover = [...images].sort((a, b) => a.sort_order - b.sort_order)[0];
    const sellerName =
      product.seller_type === "parent" ? (nameByProfile.get(product.seller_profile_id ?? "") ?? null) : (nameByBusiness.get(product.business_id ?? "") ?? null);

    return {
      productId: fav.product_id,
      savedAt: fav.created_at,
      status,
      listing: {
        id: product.id,
        title: product.title,
        price_cents: product.price_cents,
        currency: product.currency,
        condition: product.condition,
        category_id: product.category_id,
        collection_available: product.collection_available,
        delivery_available: product.delivery_available,
        created_at: product.created_at,
        cover_image_path: cover?.storage_path ?? null,
        sellerName,
      },
    };
  });
}
