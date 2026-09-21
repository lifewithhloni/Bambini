"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/requireUser";
import { createListingSchema, updateListingSchema } from "./validation";
import { buildImageStoragePath, validateImageCount, validateImageFile, type ImageFileLike } from "./imageValidation";
import { assertTransition, canTransition, type ListingStatus } from "./statusTransitions";

export type ListingActionState = { error: string } | null;

/**
 * A listing's pickup_location_id is never taken from the submitted
 * form — it's always resolved server-side from the seller's own saved
 * location (profiles.location_id, set via /account/location), and only
 * when collection is actually offered (a delivery-only listing has no
 * pickup point to publish). This is what "connect listings to pickup
 * location" means in practice (see DECISIONS.md): one location per
 * seller, referenced by every listing that offers collection, never a
 * per-listing address re-entered each time. The RLS WITH CHECK added in
 * 20260923090000_nearby_search.sql is the actual boundary preventing a
 * listing from ever referencing another seller's location — this
 * function relying on the seller's own profile row is defense in depth
 * on top of that, not a substitute for it.
 */
async function resolveOwnPickupLocationId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  collectionAvailable: boolean,
): Promise<string | null> {
  if (!collectionAvailable) return null;
  const { data } = await supabase.from("profiles").select("location_id").eq("id", userId).maybeSingle();
  return data?.location_id ?? null;
}

function extractImageFiles(formData: FormData): File[] {
  return formData
    .getAll("photos")
    .filter((v): v is File => v instanceof File && v.size > 0);
}

function validateImageFiles(files: File[], existingCount: number): { error: string } | null {
  const countCheck = validateImageCount(existingCount, files.length);
  if (!countCheck.ok) return { error: countCheck.error };

  for (const file of files) {
    const fileLike: ImageFileLike = { type: file.type, size: file.size, name: file.name };
    const fileCheck = validateImageFile(fileLike);
    if (!fileCheck.ok) return { error: fileCheck.error };
  }
  return null;
}

/** Uploads already-validated files to storage and registers them in product_images. Best-effort per file — a failure partway through doesn't roll back files that already succeeded (see DECISIONS.md). */
async function uploadImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productId: string,
  files: File[],
  startSortOrder: number,
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  for (const [index, file] of files.entries()) {
    const path = buildImageStoragePath(productId, file.type, randomUUID());
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(path, file, { contentType: file.type });

    if (uploadError) {
      failed += 1;
      continue;
    }

    const { error: insertError } = await supabase
      .from("product_images")
      .insert({ product_id: productId, storage_path: path, sort_order: startSortOrder + index });

    if (insertError) {
      failed += 1;
      await supabase.storage.from("product-images").remove([path]);
      continue;
    }

    uploaded += 1;
  }

  return { uploaded, failed };
}

/**
 * Every field here comes from the submitted form — seller_profile_id is
 * always requireUser()'s verified id, never anything the client sends,
 * and when sellerType is "business" the business_id is only accepted
 * server-side after RLS's own is_business_member() check on the INSERT
 * (see 20260920091500_rls_policies.sql) — this action doesn't duplicate
 * that check, it relies on it, which is why a bad business_id surfaces
 * as the same generic error as any other failure rather than a
 * specific "you're not a member" message.
 */
export async function createListing(_prev: ListingActionState, formData: FormData): Promise<ListingActionState> {
  const user = await requireUser();

  const parsed = createListingSchema.safeParse({
    title: formData.get("title"),
    categoryId: formData.get("categoryId"),
    condition: formData.get("condition"),
    priceCents: formData.get("priceCents"),
    description: formData.get("description"),
    collectionAvailable: formData.get("collectionAvailable"),
    deliveryAvailable: formData.get("deliveryAvailable"),
    sellerType: formData.get("sellerType"),
    businessId: formData.get("businessId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const files = extractImageFiles(formData);
  const imageError = validateImageFiles(files, 0);
  if (imageError) return imageError;

  const supabase = await createClient();
  // Business listings don't have a location workflow yet (business
  // storefronts are Phase 7) — only a parent seller's own listing gets
  // pickup_location_id auto-attached; a business listing is unaffected
  // and simply doesn't participate in Nearby until that phase.
  const pickupLocationId =
    parsed.data.sellerType === "parent"
      ? await resolveOwnPickupLocationId(supabase, user.id, parsed.data.collectionAvailable)
      : null;

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      seller_type: parsed.data.sellerType,
      seller_profile_id: parsed.data.sellerType === "parent" ? user.id : undefined,
      business_id: parsed.data.sellerType === "business" ? parsed.data.businessId : undefined,
      category_id: parsed.data.categoryId,
      title: parsed.data.title,
      description: parsed.data.description,
      condition: parsed.data.condition,
      price_cents: parsed.data.priceCents,
      collection_available: parsed.data.collectionAvailable,
      delivery_available: parsed.data.deliveryAvailable,
      pickup_location_id: pickupLocationId,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !product) {
    return { error: "Could not create the listing. Please check your details and try again." };
  }

  if (files.length > 0) {
    const { failed } = await uploadImages(supabase, product.id, files, 0);
    if (failed > 0) {
      revalidatePath("/sell");
      redirect(`/sell/${product.id}/edit?photoError=1`);
    }
  }

  revalidatePath("/sell");
  redirect(`/sell/${product.id}/edit`);
}

/** Scoped to a listing the signed-in user owns via RLS — 0 rows affected (not an error) means "not found or not yours", and both are reported identically so a stranger can't probe which listing ids exist. */
export async function updateListing(
  listingId: string,
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  const user = await requireUser();

  const parsed = updateListingSchema.safeParse({
    title: formData.get("title"),
    categoryId: formData.get("categoryId"),
    condition: formData.get("condition"),
    priceCents: formData.get("priceCents"),
    description: formData.get("description"),
    collectionAvailable: formData.get("collectionAvailable"),
    deliveryAvailable: formData.get("deliveryAvailable"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details and try again." };
  }

  const supabase = await createClient();

  // Re-resolved on every edit (not just at creation) so toggling
  // collection back on, or saving a location for the first time after
  // the listing already existed, attaches pickup_location_id
  // retroactively rather than leaving it stuck at whatever was true when
  // the listing was first created.
  const { data: existing } = await supabase.from("products").select("seller_type, status").eq("id", listingId).maybeSingle();
  if (!existing) {
    return { error: "Listing not found." };
  }
  // 'sold' is set by create_order() the instant a buyer completes a
  // purchase (see 20260925090000_orders_checkout.sql) — the order has
  // already snapshotted the title/price/etc it needs, so nothing about
  // editing the listing afterwards is unsafe in itself, but letting a
  // seller change a sold listing's price/category after the fact serves
  // no purpose and would be confusing (what would "editing" a completed
  // sale even mean to the buyer who already has their own snapshot?).
  if (existing.status === "sold") {
    return { error: "This listing has been sold and can no longer be edited." };
  }
  const pickupLocationId =
    existing.seller_type === "parent"
      ? await resolveOwnPickupLocationId(supabase, user.id, parsed.data.collectionAvailable)
      : null;

  const { data: updated, error } = await supabase
    .from("products")
    .update({
      title: parsed.data.title,
      category_id: parsed.data.categoryId,
      condition: parsed.data.condition,
      price_cents: parsed.data.priceCents,
      description: parsed.data.description,
      collection_available: parsed.data.collectionAvailable,
      delivery_available: parsed.data.deliveryAvailable,
      pickup_location_id: pickupLocationId,
    })
    .eq("id", listingId)
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { error: "Listing not found." };
  }

  revalidatePath("/sell");
  revalidatePath(`/sell/${listingId}/edit`);
  return null;
}

export type StatusActionResult = { error: string } | { success: true };

export async function changeListingStatus(listingId: string, target: ListingStatus): Promise<StatusActionResult> {
  await requireUser();
  const supabase = await createClient();

  const { data: listing, error: fetchError } = await supabase
    .from("products")
    .select("id, status")
    .eq("id", listingId)
    .maybeSingle();

  if (fetchError || !listing) {
    return { error: "Listing not found." };
  }

  if (!canTransition(listing.status, target)) {
    return { error: `Cannot move this listing from ${listing.status} to ${target}.` };
  }

  if (target === "published") {
    const { count } = await supabase
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("product_id", listingId);
    if (!count || count === 0) {
      return { error: "Add at least one photo before publishing." };
    }
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({
      status: target,
      ...(target === "published" ? { published_at: new Date().toISOString() } : {}),
    })
    .eq("id", listingId);

  if (updateError) {
    return { error: "Could not update the listing status." };
  }

  revalidatePath("/sell");
  revalidatePath(`/sell/${listingId}/edit`);
  return { success: true };
}

/** Only a draft can be hard-deleted (nothing else can reference it yet); anything else must be archived instead — an app-level rule, not an RLS one, since RLS alone would allow deleting a published listing too. */
export async function deleteListing(listingId: string): Promise<StatusActionResult> {
  await requireUser();
  const supabase = await createClient();

  const { data: listing, error: fetchError } = await supabase
    .from("products")
    .select("id, status")
    .eq("id", listingId)
    .maybeSingle();

  if (fetchError || !listing) {
    return { error: "Listing not found." };
  }
  if (listing.status !== "draft") {
    return { error: "Only draft listings can be deleted — archive this listing instead." };
  }

  const { data: images } = await supabase.from("product_images").select("storage_path").eq("product_id", listingId);

  const { error: deleteError } = await supabase.from("products").delete().eq("id", listingId);
  if (deleteError) {
    return { error: "Could not delete the listing." };
  }

  if (images && images.length > 0) {
    await supabase.storage.from("product-images").remove(images.map((i) => i.storage_path));
  }

  revalidatePath("/sell");
  return { success: true };
}

export async function addListingImages(
  listingId: string,
  _prev: ListingActionState,
  formData: FormData,
): Promise<ListingActionState> {
  await requireUser();
  const supabase = await createClient();

  const { count: existingCount } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", listingId);

  const files = extractImageFiles(formData);
  const imageError = validateImageFiles(files, existingCount ?? 0);
  if (imageError) return imageError;
  if (files.length === 0) return { error: "Choose at least one photo to add." };

  const { failed } = await uploadImages(supabase, listingId, files, existingCount ?? 0);
  revalidatePath(`/sell/${listingId}/edit`);

  if (failed > 0) {
    return { error: `${failed} photo(s) failed to upload. Please try again.` };
  }
  return null;
}

export async function removeListingImage(imageId: string, listingId: string): Promise<StatusActionResult> {
  await requireUser();
  const supabase = await createClient();

  const { data: image, error: fetchError } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("id", imageId)
    .maybeSingle();

  if (fetchError || !image) {
    return { error: "Photo not found." };
  }

  const { error: deleteError } = await supabase.from("product_images").delete().eq("id", imageId);
  if (deleteError) {
    return { error: "Could not remove the photo." };
  }

  await supabase.storage.from("product-images").remove([image.storage_path]);

  revalidatePath(`/sell/${listingId}/edit`);
  return { success: true };
}

/** Re-exported so callers doing their own transition-graph validation before rendering (e.g. dimming a disallowed button) stay in sync with the server's own rule. */
export { assertTransition };
