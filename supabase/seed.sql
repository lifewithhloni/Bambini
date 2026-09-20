-- Local development seed data. Run automatically by `supabase db reset`.
-- Categories mirror the initial taxonomy in the product brief; slugs are
-- stable identifiers the app can reference safely even as `name` changes.

with top_level as (
  insert into public.categories (name, slug, sort_order) values
    ('Clothing', 'clothing', 1),
    ('Baby Gear', 'baby-gear', 2),
    ('Toys', 'toys', 3),
    ('Feeding', 'feeding', 4),
    ('Nursery', 'nursery', 5),
    ('Maternity', 'maternity', 6)
  returning id, slug
)
insert into public.categories (parent_id, name, slug, sort_order)
select t.id, sub.name, sub.slug, sub.sort_order
from top_level t
join (
  values
    ('clothing', 'Newborn', 'clothing-newborn', 1),
    ('clothing', '0-3 months', 'clothing-0-3-months', 2),
    ('clothing', '3-6 months', 'clothing-3-6-months', 3),
    ('clothing', '6-12 months', 'clothing-6-12-months', 4),
    ('clothing', '1-2 years', 'clothing-1-2-years', 5),
    ('clothing', 'Toddler', 'clothing-toddler', 6),
    ('clothing', 'Kids', 'clothing-kids', 7),
    ('baby-gear', 'Prams', 'baby-gear-prams', 1),
    ('baby-gear', 'Strollers', 'baby-gear-strollers', 2),
    ('baby-gear', 'Cots', 'baby-gear-cots', 3),
    ('baby-gear', 'High Chairs', 'baby-gear-high-chairs', 4),
    ('baby-gear', 'Baby Carriers', 'baby-gear-carriers', 5),
    ('baby-gear', 'Baby Baths', 'baby-gear-baths', 6),
    ('baby-gear', 'Changing Tables', 'baby-gear-changing-tables', 7),
    ('baby-gear', 'Baby Accessories', 'baby-gear-accessories', 8),
    ('toys', 'Baby Toys', 'toys-baby', 1),
    ('toys', 'Educational', 'toys-educational', 2),
    ('toys', 'Toddler', 'toys-toddler', 3),
    ('toys', 'Kids', 'toys-kids', 4),
    ('toys', 'Outdoor', 'toys-outdoor', 5),
    ('feeding', 'Bottles', 'feeding-bottles', 1),
    ('feeding', 'Sterilisers', 'feeding-sterilisers', 2),
    ('feeding', 'Feeding Accessories', 'feeding-accessories', 3),
    ('feeding', 'Nursing Products', 'feeding-nursing', 4),
    ('nursery', 'Furniture', 'nursery-furniture', 1),
    ('nursery', 'Bedding', 'nursery-bedding', 2),
    ('nursery', 'Decor', 'nursery-decor', 3),
    ('nursery', 'Storage', 'nursery-storage', 4),
    ('maternity', 'Maternity Clothing', 'maternity-clothing', 1),
    ('maternity', 'Pregnancy Accessories', 'maternity-pregnancy-accessories', 2)
) as sub (parent_slug, name, slug, sort_order) on sub.parent_slug = t.slug;

-- Commission rates, effective from the beginning of time.
insert into public.commission_rates (seller_type, rate_bps, effective_from) values
  ('parent', 1200, '2020-01-01T00:00:00Z'),
  ('business', 1500, '2020-01-01T00:00:00Z');

-- Providers: only the mock adapters are active by default. Enable a real
-- provider by inserting/activating its row once its env vars are set —
-- see ENVIRONMENT.md.
insert into public.payment_providers (slug, name, is_active) values
  ('mock', 'Mock Payment Provider (local dev)', true);

insert into public.delivery_providers (slug, name, is_active) values
  ('mock', 'Mock Delivery Provider (local dev)', true);

-- Default cash-eligibility bar. New sellers start ineligible until they
-- meet all active criteria — see ARCHITECTURE.md "Cash collection".
insert into public.cash_eligibility_criteria (key, label, threshold) values
  ('min_completed_transactions', 'Minimum completed transactions', '3'),
  ('min_rating_average', 'Minimum seller rating', '4'),
  ('requires_account_verification', 'Requires account verification', 'true'),
  ('requires_identity_verification', 'Requires identity verification', 'true'),
  ('max_unresolved_disputes', 'Maximum unresolved disputes', '0');
