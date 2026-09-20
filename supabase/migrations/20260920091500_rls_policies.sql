-- =============================================================================
-- Row Level Security
--
-- Two broad categories of table, deliberately treated differently:
--
-- 1. Money-moving / state-machine tables (orders, payments, commissions,
--    payouts, refunds, delivery_quotes, delivery_orders,
--    collection_confirmations, seller_cash_status, subscriptions,
--    subscription_transactions, promotions, transaction_events,
--    commission_rates): users get SELECT policies scoped to rows they're
--    party to, and NO insert/update/delete policy for `authenticated` at
--    all. Every write to these tables happens server-side, through the
--    service-role client, only after application code has validated the
--    business rules (commission math, cash eligibility, order state
--    transitions, authorization). This is simpler and safer than trying
--    to encode a full order state machine in RLS, and matches "never
--    trust frontend calculations for commission/totals/payouts" from the
--    product brief. See DECISIONS.md.
--
-- 2. Content tables (profiles, businesses, products, messages, reviews,
--    ...) where direct client reads/writes through RLS are the normal
--    path, scoped to the owning user/business or public where the
--    product intentionally makes something public (active listings,
--    reviews, categories).
--
-- Sensitive raw tables (locations, and the full profiles/businesses
-- rows) are never selectable by arbitrary users; profiles_public /
-- businesses_public views and the search_nearby_products() function are
-- the sanctioned public-read surface. See DATABASE.md.
-- =============================================================================

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = target_business_id and b.owner_profile_id = auth.uid()
  ) or exists (
    select 1 from public.business_members bm
    where bm.business_id = target_business_id and bm.profile_id = auth.uid()
  );
$$;

-- Profiles --------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own_or_admin on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

create policy profiles_update_own_or_admin on public.profiles
  for update using (id = auth.uid() or public.is_admin());

-- Column-level defense in depth: even though the policy above lets a
-- user UPDATE their own row, only these columns are actually writable
-- by them — role, verification, standing and cached stats are
-- server/admin-controlled.
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, phone, location_id) on public.profiles to authenticated;

create view public.profiles_public
  with (security_invoker = false) as
  select id, full_name, avatar_url, role, account_verification, rating_average, rating_count, created_at
  from public.profiles;

grant select on public.profiles_public to anon, authenticated;

-- Identity verifications --------------------------------------------------
alter table public.identity_verifications enable row level security;

create policy identity_verifications_select_own_or_admin on public.identity_verifications
  for select using (profile_id = auth.uid() or public.is_admin());

create policy identity_verifications_insert_own on public.identity_verifications
  for insert with check (profile_id = auth.uid());

create policy identity_verifications_update_admin on public.identity_verifications
  for update using (public.is_admin());

-- Businesses ----------------------------------------------------------------
alter table public.businesses enable row level security;

create policy businesses_select_member_or_admin on public.businesses
  for select using (
    owner_profile_id = auth.uid() or public.is_business_member(id) or public.is_admin()
  );

create policy businesses_insert_own on public.businesses
  for insert with check (owner_profile_id = auth.uid());

create policy businesses_update_owner_or_admin on public.businesses
  for update using (owner_profile_id = auth.uid() or public.is_admin());

revoke update on public.businesses from authenticated;
grant update (business_name, description, logo_url, location_id) on public.businesses to authenticated;

create view public.businesses_public
  with (security_invoker = false) as
  select id, business_name, slug, logo_url, description, verification_status, rating_average, rating_count, created_at
  from public.businesses
  where verification_status = 'verified';

grant select on public.businesses_public to anon, authenticated;

alter table public.business_members enable row level security;

create policy business_members_select on public.business_members
  for select using (
    profile_id = auth.uid() or public.is_business_member(business_id) or public.is_admin()
  );

create policy business_members_insert_owner on public.business_members
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_profile_id = auth.uid()
    )
  );

create policy business_members_delete_owner_or_admin on public.business_members
  for delete using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id and b.owner_profile_id = auth.uid()
    ) or public.is_admin()
  );

alter table public.business_verifications enable row level security;

create policy business_verifications_select on public.business_verifications
  for select using (public.is_business_member(business_id) or public.is_admin());

create policy business_verifications_insert on public.business_verifications
  for insert with check (public.is_business_member(business_id));

create policy business_verifications_update_admin on public.business_verifications
  for update using (public.is_admin());

-- Locations -----------------------------------------------------------------
-- Deliberately no public select policy. Public reads go through
-- search_nearby_products() and product_locations_public (below), which
-- both return a fuzzed/rounded view, never raw lat/lng or
-- formatted_address.
alter table public.locations enable row level security;

create policy locations_select_own_or_admin on public.locations
  for select using (created_by = auth.uid() or public.is_admin());

create policy locations_insert_own on public.locations
  for insert with check (created_by = auth.uid());

create policy locations_update_own_or_admin on public.locations
  for update using (created_by = auth.uid() or public.is_admin());

create policy locations_delete_own_or_admin on public.locations
  for delete using (created_by = auth.uid() or public.is_admin());

-- Categories ------------------------------------------------------------
alter table public.categories enable row level security;

create policy categories_select_all on public.categories
  for select using (true);

create policy categories_write_admin on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- Products --------------------------------------------------------------
alter table public.products enable row level security;

create policy products_select_active_or_owner_or_admin on public.products
  for select using (
    status = 'active'
    or seller_profile_id = auth.uid()
    or public.is_business_member(business_id)
    or public.is_admin()
  );

create policy products_insert_owner on public.products
  for insert with check (
    (seller_type = 'parent' and seller_profile_id = auth.uid())
    or (seller_type = 'business' and public.is_business_member(business_id))
  );

create policy products_update_owner_or_admin on public.products
  for update using (
    seller_profile_id = auth.uid() or public.is_business_member(business_id) or public.is_admin()
  );

create policy products_delete_owner_or_admin on public.products
  for delete using (
    seller_profile_id = auth.uid() or public.is_business_member(business_id) or public.is_admin()
  );

-- Public suburb/city for a product's pickup point, never raw coordinates
-- or the formatted address — the single-product-page equivalent of what
-- search_nearby_products() returns for listings.
create view public.product_locations_public
  with (security_invoker = false) as
  select p.id as product_id, l.suburb, l.city, l.province
  from public.products p
  join public.locations l on l.id = p.pickup_location_id
  where p.status = 'active';

grant select on public.product_locations_public to anon, authenticated;

alter table public.product_images enable row level security;

create policy product_images_select on public.product_images
  for select using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and (
          p.status = 'active'
          or p.seller_profile_id = auth.uid()
          or public.is_business_member(p.business_id)
          or public.is_admin()
        )
    )
  );

create policy product_images_write_owner on public.product_images
  for all using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and (p.seller_profile_id = auth.uid() or public.is_business_member(p.business_id))
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and (p.seller_profile_id = auth.uid() or public.is_business_member(p.business_id))
    )
  );

alter table public.product_favourites enable row level security;

create policy product_favourites_owner on public.product_favourites
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Commerce config -----------------------------------------------------------
alter table public.commission_rates enable row level security;
create policy commission_rates_select_admin on public.commission_rates
  for select using (public.is_admin());

alter table public.payment_providers enable row level security;
create policy payment_providers_select_active on public.payment_providers
  for select using (is_active or public.is_admin());

alter table public.delivery_providers enable row level security;
create policy delivery_providers_select_active on public.delivery_providers
  for select using (is_active or public.is_admin());

alter table public.cash_eligibility_criteria enable row level security;
create policy cash_eligibility_criteria_select_admin on public.cash_eligibility_criteria
  for select using (public.is_admin());

-- Orders and everything money-related ---------------------------------
-- SELECT only for regular users; all writes happen server-side (service
-- role) — see the header comment on this migration.
alter table public.orders enable row level security;
create policy orders_select_participant_or_admin on public.orders
  for select using (
    buyer_id = auth.uid()
    or seller_profile_id = auth.uid()
    or public.is_business_member(business_id)
    or public.is_admin()
  );

alter table public.order_items enable row level security;
create policy order_items_select_participant_or_admin on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.buyer_id = auth.uid()
          or o.seller_profile_id = auth.uid()
          or public.is_business_member(o.business_id)
          or public.is_admin()
        )
    )
  );

alter table public.payments enable row level security;
create policy payments_select_participant_or_admin on public.payments
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.buyer_id = auth.uid()
          or o.seller_profile_id = auth.uid()
          or public.is_business_member(o.business_id)
          or public.is_admin()
        )
    )
  );

alter table public.commissions enable row level security;
create policy commissions_select_seller_or_admin on public.commissions
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.seller_profile_id = auth.uid() or public.is_business_member(o.business_id))
    )
    or public.is_admin()
  );

alter table public.payouts enable row level security;
create policy payouts_select_recipient_or_admin on public.payouts
  for select using (
    recipient_profile_id = auth.uid() or public.is_business_member(recipient_business_id) or public.is_admin()
  );

alter table public.payout_items enable row level security;
create policy payout_items_select_recipient_or_admin on public.payout_items
  for select using (
    exists (
      select 1 from public.payouts p
      where p.id = payout_id
        and (
          p.recipient_profile_id = auth.uid()
          or public.is_business_member(p.recipient_business_id)
          or public.is_admin()
        )
    )
  );

alter table public.refunds enable row level security;
create policy refunds_select_participant_or_admin on public.refunds
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.buyer_id = auth.uid()
          or o.seller_profile_id = auth.uid()
          or public.is_business_member(o.business_id)
          or public.is_admin()
        )
    )
  );

alter table public.delivery_quotes enable row level security;
create policy delivery_quotes_select_own_or_admin on public.delivery_quotes
  for select using (
    order_id is null
    or exists (
      select 1 from public.orders o
      where o.id = order_id and (o.buyer_id = auth.uid() or public.is_admin())
    )
  );

alter table public.delivery_orders enable row level security;
create policy delivery_orders_select_participant_or_admin on public.delivery_orders
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.buyer_id = auth.uid()
          or o.seller_profile_id = auth.uid()
          or public.is_business_member(o.business_id)
          or public.is_admin()
        )
    )
  );

alter table public.collection_confirmations enable row level security;
create policy collection_confirmations_select_participant_or_admin on public.collection_confirmations
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.buyer_id = auth.uid()
          or o.seller_profile_id = auth.uid()
          or public.is_business_member(o.business_id)
          or public.is_admin()
        )
    )
  );

alter table public.seller_cash_status enable row level security;
create policy seller_cash_status_select_own_or_admin on public.seller_cash_status
  for select using (
    seller_profile_id = auth.uid() or public.is_business_member(business_id) or public.is_admin()
  );

alter table public.subscriptions enable row level security;
create policy subscriptions_select_own_or_admin on public.subscriptions
  for select using (profile_id = auth.uid() or public.is_admin());

alter table public.subscription_transactions enable row level security;
create policy subscription_transactions_select_own_or_admin on public.subscription_transactions
  for select using (
    exists (
      select 1 from public.subscriptions s
      where s.id = subscription_id and (s.profile_id = auth.uid() or public.is_admin())
    )
  );

alter table public.promotions enable row level security;
create policy promotions_select_owner_or_admin on public.promotions
  for select using (
    exists (
      select 1 from public.products p
      where p.id = product_id
        and (p.seller_profile_id = auth.uid() or public.is_business_member(p.business_id))
    )
    or public.is_admin()
  );

alter table public.transaction_events enable row level security;
create policy transaction_events_select_participant_or_admin on public.transaction_events
  for select using (
    public.is_admin()
    or (
      order_id is not null
      and exists (
        select 1 from public.orders o
        where o.id = order_id
          and (
            o.buyer_id = auth.uid()
            or o.seller_profile_id = auth.uid()
            or public.is_business_member(o.business_id)
          )
      )
    )
  );

-- Messaging -----------------------------------------------------------------
alter table public.message_threads enable row level security;
create policy message_threads_select_participant_or_admin on public.message_threads
  for select using (
    buyer_id = auth.uid()
    or seller_profile_id = auth.uid()
    or public.is_business_member(business_id)
    or public.is_admin()
  );

create policy message_threads_insert_buyer on public.message_threads
  for insert with check (buyer_id = auth.uid());

alter table public.messages enable row level security;
create policy messages_select_participant_or_admin on public.messages
  for select using (
    exists (
      select 1 from public.message_threads t
      where t.id = thread_id
        and (
          t.buyer_id = auth.uid()
          or t.seller_profile_id = auth.uid()
          or public.is_business_member(t.business_id)
          or public.is_admin()
        )
    )
  );

create policy messages_insert_participant on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.message_threads t
      where t.id = thread_id
        and (t.buyer_id = auth.uid() or t.seller_profile_id = auth.uid() or public.is_business_member(t.business_id))
    )
  );

create policy messages_update_recipient_mark_read on public.messages
  for update using (
    exists (
      select 1 from public.message_threads t
      where t.id = thread_id
        and (t.buyer_id = auth.uid() or t.seller_profile_id = auth.uid() or public.is_business_member(t.business_id))
    )
  );

-- Reviews -------------------------------------------------------------------
-- Public trust signal: visible to everyone, like any marketplace review.
alter table public.reviews enable row level security;
create policy reviews_select_all on public.reviews
  for select using (true);

create policy reviews_insert_buyer_on_completed_order on public.reviews
  for insert with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.buyer_id = auth.uid() and o.status = 'completed'
    )
  );

-- Notifications ---------------------------------------------------------
alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications
  for select using (profile_id = auth.uid());

create policy notifications_update_own_mark_read on public.notifications
  for update using (profile_id = auth.uid());

-- Reports and disputes --------------------------------------------------
alter table public.reports enable row level security;
create policy reports_select_own_or_admin on public.reports
  for select using (reporter_id = auth.uid() or public.is_admin());

create policy reports_insert_own on public.reports
  for insert with check (reporter_id = auth.uid());

create policy reports_update_admin on public.reports
  for update using (public.is_admin());

alter table public.disputes enable row level security;
create policy disputes_select_participant_or_admin on public.disputes
  for select using (
    raised_by = auth.uid()
    or exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.buyer_id = auth.uid() or o.seller_profile_id = auth.uid() or public.is_business_member(o.business_id))
    )
    or public.is_admin()
  );

create policy disputes_insert_participant on public.disputes
  for insert with check (
    raised_by = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.buyer_id = auth.uid() or o.seller_profile_id = auth.uid() or public.is_business_member(o.business_id))
    )
  );

create policy disputes_update_admin on public.disputes
  for update using (public.is_admin());

-- Admin actions ---------------------------------------------------------
alter table public.admin_actions enable row level security;
create policy admin_actions_select_admin on public.admin_actions
  for select using (public.is_admin());

create policy admin_actions_insert_admin on public.admin_actions
  for insert with check (public.is_admin());
