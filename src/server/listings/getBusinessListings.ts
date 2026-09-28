import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MyListing } from "./getMyListings";

/**
 * Phase 13B: one specific business's own listings — the business-scoped
 * counterpart to getMyListings() (which deliberately aggregates a user's
 * personal AND every business's listings). RLS (products read: published
 * OR owner OR is_business_member()) is the real boundary; the explicit
 * .eq("business_id") narrows it to the one business a page is about, and
 * the caller (a business management page) has already confirmed
 * membership via getBusinessForManage(). A businessId the caller isn't a
 * member of only ever returns that business's *published* listings —
 * never drafts — because that's all RLS lets any stranger see.
 */
export async function getBusinessListings(businessId: string): Promise<MyListing[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select("id, title, price_cents, status, condition, created_at, updated_at, seller_type, product_images(storage_path, sort_order)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => {
    const images = (row.product_images ?? []) as { storage_path: string; sort_order: number }[];
    const cover = [...images].sort((a, b) => a.sort_order - b.sort_order)[0];
    return {
      id: row.id,
      title: row.title,
      price_cents: row.price_cents,
      status: row.status,
      condition: row.condition,
      created_at: row.created_at,
      updated_at: row.updated_at,
      seller_type: row.seller_type,
      cover_image_path: cover?.storage_path ?? null,
    };
  });
}
