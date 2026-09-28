-- Phase 14A hardening: a NEW favourite may only reference a currently
-- published listing, enforced by the database rather than only by the
-- application.
--
-- The previous policy (20260920091500_rls_policies.sql) was a single
--   create policy product_favourites_owner on public.product_favourites
--     for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
-- which is owner-only but says nothing about the product. The saved-items
-- feature's saveListing() server action correctly refuses anything that
-- isn't published, but a direct database caller could still insert a
-- favourite for a draft/archived/sold listing whose UUID they knew. That
-- is a privacy-adjacent gap (the row itself is only ever readable by its
-- owner, but it lets someone probe for unpublished product ids and hang
-- private rows off them), so it is closed here as defense in depth — the
-- application check stays.
--
-- What is and is not restricted, deliberately:
--   * A favourite is the user's own intent/history. Existing rows MUST
--     survive their listing later becoming sold or archived, and the owner
--     must always be able to read and delete them. So SELECT and DELETE
--     stay owner-only and never look at the product's status.
--   * Only CREATING a favourite (and re-pointing one, see below) requires
--     the referenced product to be published right now.
--
-- Why the single FOR ALL policy has to be split: a FOR ALL policy's
-- WITH CHECK applies to INSERT and UPDATE alike but its USING applies to
-- SELECT/UPDATE/DELETE, so there is no way to say "check the product's
-- status on writes but never on reads/deletes" in one policy. Four
-- narrow policies express it exactly.
--
-- UPDATE needs the same product check as INSERT: without it, a user could
-- INSERT a favourite for a published product and then UPDATE its
-- product_id to a draft's id, sidestepping the insert rule entirely. The
-- application never updates a favourite (a favourite is either present or
-- absent), so this costs nothing legitimate.
--
-- The `exists (select 1 from products ...)` subquery runs under the
-- caller's own RLS on products, which is exactly right: a non-owner can
-- only see published products, and the explicit status = 'published'
-- predicate additionally rejects an owner favouriting their own
-- draft/archived/sold listing. No new policy on products is added and no
-- role bypasses RLS.

drop policy product_favourites_owner on public.product_favourites;

create policy product_favourites_select_own on public.product_favourites
  for select using (profile_id = auth.uid());

create policy product_favourites_insert_own_published on public.product_favourites
  for insert with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.status = 'published'
    )
  );

create policy product_favourites_update_own_published on public.product_favourites
  for update
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.status = 'published'
    )
  );

create policy product_favourites_delete_own on public.product_favourites
  for delete using (profile_id = auth.uid());
