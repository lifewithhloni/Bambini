import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ThreadRow = {
  id: string;
  product_id: string | null;
  buyer_id: string;
  seller_type: "parent" | "business";
  seller_profile_id: string | null;
  business_id: string | null;
};

export type Counterpart = { name: string; avatarUrl: string | null };

/**
 * "Who is on the other end" for each thread, from the PUBLIC views only
 * (profiles_public / businesses_public — a display name and avatar/logo,
 * nothing private). A buyer sees the selling side (the business as a whole
 * for a business thread — never an individual member); the selling side
 * sees the buyer. Business member lists are never read or exposed.
 */
export async function getCounterparts(threads: ThreadRow[], viewerId: string): Promise<Map<string, Counterpart>> {
  const supabase = await createClient();

  const profileIds = new Set<string>();
  const businessIds = new Set<string>();
  for (const t of threads) {
    if (t.buyer_id === viewerId) {
      if (t.seller_type === "parent" && t.seller_profile_id) profileIds.add(t.seller_profile_id);
      if (t.seller_type === "business" && t.business_id) businessIds.add(t.business_id);
    } else {
      profileIds.add(t.buyer_id);
    }
  }

  const [{ data: profiles }, { data: businesses }] = await Promise.all([
    profileIds.size > 0 ? supabase.from("profiles_public").select("id, full_name, avatar_url").in("id", [...profileIds]) : Promise.resolve({ data: [] as { id: string; full_name: string; avatar_url: string | null }[] }),
    businessIds.size > 0 ? supabase.from("businesses_public").select("id, business_name, logo_url").in("id", [...businessIds]) : Promise.resolve({ data: [] as { id: string; business_name: string; logo_url: string | null }[] }),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, { name: p.full_name, avatarUrl: p.avatar_url }]));
  const businessById = new Map((businesses ?? []).map((b) => [b.id, { name: b.business_name, avatarUrl: b.logo_url }]));

  const result = new Map<string, Counterpart>();
  for (const t of threads) {
    let found: Counterpart | undefined;
    if (t.buyer_id === viewerId) {
      found = t.seller_type === "business" ? businessById.get(t.business_id ?? "") : profileById.get(t.seller_profile_id ?? "");
    } else {
      found = profileById.get(t.buyer_id);
    }
    result.set(t.id, found ?? { name: t.buyer_id === viewerId ? "Seller" : "Buyer", avatarUrl: null });
  }
  return result;
}
