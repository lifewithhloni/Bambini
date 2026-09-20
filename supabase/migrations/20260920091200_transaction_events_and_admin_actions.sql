-- Transaction events ----------------------------------------------------
-- The central audit trail: "every transaction has a record." Every state
-- change that matters financially or operationally — order created,
-- payment authorized, collection code confirmed, commission recorded,
-- delivery status changed, refund processed, dispute opened — is
-- appended here, in addition to (not instead of) the normal relational
-- rows those tables already have. entity_type/entity_id point at the row
-- the event is about; order_id is denormalized on so "show me everything
-- that happened on this order" is a single indexed query.
create table public.transaction_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  actor_type actor_type not null,
  actor_id uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index transaction_events_order_id_idx on public.transaction_events (order_id, created_at);
create index transaction_events_entity_idx on public.transaction_events (entity_type, entity_id);

-- Append-only: block UPDATE/DELETE even for roles that would otherwise
-- pass RLS (e.g. the service role, which bypasses RLS entirely), so a
-- bug can't silently rewrite audit history.
create function public.prevent_transaction_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'transaction_events is append-only';
end;
$$;

create trigger transaction_events_no_update
  before update on public.transaction_events
  for each row execute function public.prevent_transaction_event_mutation();

create trigger transaction_events_no_delete
  before delete on public.transaction_events
  for each row execute function public.prevent_transaction_event_mutation();

-- Admin actions -----------------------------------------------------------
-- Audit trail for platform-staff actions (approving a verification,
-- resolving a dispute, suspending an account) distinct from
-- transaction_events, which is scoped to order/financial events.
create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id) on delete restrict,
  action_type text not null,
  target_type text not null,
  target_id uuid not null,
  notes text,
  created_at timestamptz not null default now()
);

create index admin_actions_admin_id_idx on public.admin_actions (admin_id, created_at desc);
