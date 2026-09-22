/**
 * Hand-maintained until the real types can be generated from a running
 * database:
 *
 *   npm run db:types   (requires `supabase start` or a linked project)
 *
 * No Docker/live Supabase project has been available in this environment
 * to run that command yet, so only the tables application code actually
 * queries are typed here, transcribed carefully from supabase/migrations/.
 * Once `db:types` has been run for real, replace this whole file with
 * its output and stop hand-editing it.
 */

type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
type AccountStanding = "good" | "warned" | "suspended";
type UserRole = "parent" | "admin";
type SellerType = "parent" | "business";
// 'sold' is a real, app-written value as of Phase 4A — create_order()
// transitions a listing 'published' -> 'sold' atomically at purchase
// (see supabase/migrations/20260925090000_orders_checkout.sql). Only
// that function ever writes it; the seller's own status-change UI
// (src/server/listings/statusTransitions.ts) still only knows about
// draft/published/archived, deliberately — a sold listing isn't a
// seller-initiated transition target. 'removed' remains the one
// genuinely unused legacy label (see DECISIONS.md).
type ProductStatus = "draft" | "published" | "archived" | "sold";
type ProductCondition = "like_new" | "excellent" | "good" | "fair";
type FulfilmentType = "collection" | "delivery";
type PaymentMethod = "online" | "cash";
// The DB enum has more values (ready_for_collection, awaiting_delivery,
// in_transit, disputed, refunded) than Phase 4A ever writes — 'confirmed'
// is the eventual "payment succeeded" transition a real payment provider
// will drive later; this phase only ever creates orders at
// 'pending_payment' and reads back whatever a future phase writes, so the
// full enum is typed even though only two values are reachable today.
type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "ready_for_collection"
  | "awaiting_delivery"
  | "in_transit"
  | "completed"
  | "cancelled"
  | "disputed"
  | "refunded";
type PaymentStatus = "pending" | "authorized" | "paid" | "failed" | "refunded" | "partially_refunded";
// Phase 4C — see 20260927090000_cash_collection_transactions.sql for why
// this exists: commissions previously had no way to say whether Bambini
// had actually received its cut. 'settled' is reserved for a future
// financial-settlement phase; nothing in this codebase currently writes
// it to mean "collected."
type CommissionSettlementStatus = "collected_via_payment" | "owed_by_seller" | "settled";
type DeliveryServiceLevel = "cheapest" | "standard" | "express";
// Phase 7A only ever reaches 'pending' (reserved, pre-provider-call) and
// 'booked' (the mock's only bookDelivery() outcome — see
// src/server/delivery/providers/mock.ts). 'collected_by_courier' /
// 'in_transit' / 'delivered' / 'failed' / 'cancelled' are typed because
// they're real DB enum values a future real provider (or
// cancelDelivery(), once something calls it) will actually write, not
// because Phase 7A writes them.
type DeliveryOrderStatus = "pending" | "booked" | "collected_by_courier" | "in_transit" | "delivered" | "failed" | "cancelled";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string;
          avatar_url: string | null;
          phone: string | null;
          location_id: string | null;
          // Phase 5: account_verification is retained but no longer
          // read by anything authorization-relevant — account
          // verification is derived live from auth.users
          // (email_confirmed_at/phone_confirmed_at) via can_transact(),
          // never cached here. identity_verification IS still
          // authoritative-by-cache: a trigger
          // (sync_profile_identity_verification()) keeps it equal to
          // the latest identity_verifications row's status every time
          // one is inserted or reviewed — see
          // 20260928090000_identity_account_verification.sql.
          account_verification: VerificationStatus;
          identity_verification: VerificationStatus;
          account_standing: AccountStanding;
          rating_average: number | null;
          rating_count: number;
          completed_transaction_count: number;
          is_parent_plus: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          avatar_url?: string | null;
          phone?: string | null;
          location_id?: string | null;
        };
        // Matches the column-level GRANT: only these are writable by a
        // signed-in user (see supabase/migrations/*_rls_policies.sql).
        Update: {
          full_name?: string;
          avatar_url?: string | null;
          phone?: string | null;
          location_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_location_id_fkey";
            columns: ["location_id"];
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };

      // Phase 5. id_number is deliberately included here (never on
      // profiles or any broadly-readable table) — RLS restricts SELECT
      // to the submitting owner or an admin (row-level; there is no
      // "other legitimate participant" concept for this table the way
      // orders has buyer+seller). Insert matches the exact column-level
      // GRANT (status/reviewed_by/reviewed_at/notes fall back to their
      // defaults regardless of what's sent). Update is `never` — the
      // only sanctioned write to status/reviewed_by/reviewed_at/notes is
      // the review_identity_verification() RPC, never a raw client
      // UPDATE (the RLS policy that used to allow one was dropped by
      // this same migration).
      identity_verifications: {
        Row: {
          id: string;
          profile_id: string;
          provider: string;
          document_type: string;
          document_storage_path: string;
          id_number: string;
          status: VerificationStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          profile_id: string;
          provider: string;
          document_type: string;
          document_storage_path: string;
          id_number: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "identity_verifications_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      categories: {
        Row: {
          id: string;
          parent_id: string | null;
          name: string;
          slug: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          parent_id?: string | null;
          name: string;
          slug: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: Partial<{
          parent_id: string | null;
          name: string;
          slug: string;
          sort_order: number;
          is_active: boolean;
        }>;
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };

      businesses: {
        Row: {
          id: string;
          owner_profile_id: string;
          business_name: string;
          slug: string;
          registration_number: string | null;
          vat_number: string | null;
          description: string | null;
          logo_url: string | null;
          location_id: string | null;
          verification_status: VerificationStatus;
          account_standing: AccountStanding;
          rating_average: number | null;
          rating_count: number;
          completed_transaction_count: number;
          created_at: string;
          updated_at: string;
        };
        // Matches the column-level INSERT grant — verification_status,
        // account_standing and the rating/stat columns are deliberately
        // not settable, so they fall back to their DB defaults
        // regardless of what a client sends (see
        // 20260920100000_restrict_insert_columns.sql).
        Insert: {
          owner_profile_id: string;
          business_name: string;
          slug: string;
          registration_number?: string | null;
          vat_number?: string | null;
          description?: string | null;
          logo_url?: string | null;
          location_id?: string | null;
        };
        Update: Partial<{
          business_name: string;
          description: string | null;
          logo_url: string | null;
          location_id: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "businesses_owner_profile_id_fkey";
            columns: ["owner_profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      business_members: {
        Row: {
          business_id: string;
          profile_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          business_id: string;
          profile_id: string;
          role?: string;
        };
        Update: Partial<{ role: string }>;
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey";
            columns: ["business_id"];
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };

      // Phase 6, mirroring identity_verifications exactly. Update is
      // `never` — the only sanctioned write to status/reviewed_by/
      // reviewed_at/notes is review_business_verification(); the RLS
      // policy that used to allow a raw admin UPDATE was dropped by
      // this migration (see 20260929090000_business_onboarding_storefront.sql).
      business_verifications: {
        Row: {
          id: string;
          business_id: string;
          document_type: string;
          document_storage_path: string;
          status: VerificationStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          business_id: string;
          document_type: string;
          document_storage_path: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "business_verifications_business_id_fkey";
            columns: ["business_id"];
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };

      products: {
        Row: {
          id: string;
          seller_type: SellerType;
          seller_profile_id: string | null;
          business_id: string | null;
          category_id: string;
          title: string;
          description: string | null;
          condition: ProductCondition;
          price_cents: number;
          currency: string;
          collection_available: boolean;
          delivery_available: boolean;
          pickup_location_id: string | null;
          status: ProductStatus;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          seller_type: SellerType;
          seller_profile_id?: string | null;
          business_id?: string | null;
          category_id: string;
          title: string;
          description?: string | null;
          condition: ProductCondition;
          price_cents: number;
          currency?: string;
          collection_available?: boolean;
          delivery_available?: boolean;
          pickup_location_id?: string | null;
          status?: ProductStatus;
        };
        Update: Partial<{
          seller_type: SellerType;
          seller_profile_id: string | null;
          business_id: string | null;
          category_id: string;
          title: string;
          description: string | null;
          condition: ProductCondition;
          price_cents: number;
          currency: string;
          collection_available: boolean;
          delivery_available: boolean;
          pickup_location_id: string | null;
          status: ProductStatus;
          published_at: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_seller_profile_id_fkey";
            columns: ["seller_profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_business_id_fkey";
            columns: ["business_id"];
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };

      locations: {
        // `geo` is a STORED GENERATED column (see
        // 20260920090100_locations_and_profiles.sql) — Postgres rejects
        // an INSERT/UPDATE that names it, so it's deliberately absent
        // from Insert/Update, not just Row.
        Row: {
          id: string;
          created_by: string | null;
          label: string | null;
          latitude: number;
          longitude: number;
          suburb: string | null;
          city: string | null;
          province: string | null;
          postal_code: string | null;
          formatted_address: string | null;
          created_at: string;
        };
        Insert: {
          created_by?: string | null;
          label?: string | null;
          latitude: number;
          longitude: number;
          suburb?: string | null;
          city?: string | null;
          province?: string | null;
          postal_code?: string | null;
          formatted_address?: string | null;
        };
        Update: Partial<{
          label: string | null;
          latitude: number;
          longitude: number;
          suburb: string | null;
          city: string | null;
          province: string | null;
          postal_code: string | null;
          formatted_address: string | null;
        }>;
        // created_by references auth.users(id), which this hand-maintained
        // file doesn't model (only the public schema is typed here) — no
        // app code joins through it, so left empty rather than asserting
        // an inaccurate public-schema relationship.
        Relationships: [];
      };

      product_images: {
        Row: {
          id: string;
          product_id: string;
          storage_path: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          product_id: string;
          storage_path: string;
          sort_order?: number;
        };
        Update: Partial<{ sort_order: number }>;
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };

      // orders/order_items/payments/commissions: every write goes
      // through create_order() (SECURITY DEFINER — see
      // 20260925090000_orders_checkout.sql), never a direct
      // .insert()/.update() from application code — RLS wouldn't allow
      // it if it tried (SELECT-only policies for `authenticated`; see
      // 20260920091500_rls_policies.sql). Insert/Update are still typed
      // (as `never`, since nothing should ever construct one) rather
      // than omitted — the Supabase client's generic constraint requires
      // every table to have all four members, and omitting them broke
      // type inference for every *other* table in this file too, not
      // just these ones (caught by `npm run typecheck` immediately
      // going from 0 to ~90 errors across unrelated files).
      orders: {
        Row: {
          id: string;
          order_reference: string;
          buyer_id: string;
          seller_type: SellerType;
          seller_profile_id: string | null;
          business_id: string | null;
          fulfilment_type: FulfilmentType;
          payment_method: PaymentMethod;
          status: OrderStatus;
          subtotal_cents: number;
          delivery_fee_cents: number;
          // Phase 7C: the reconciliation breakdown behind delivery_fee_cents
          // — the provider's own raw cost, the markup rate applied, and the
          // resulting margin. Snapshotted once at order creation from the
          // delivery_quotes row create_order() validated (see
          // 20261002090000_delivery_markup.sql); always 0 for collection.
          provider_delivery_cost_cents: number;
          delivery_markup_percentage_bps: number;
          delivery_markup_amount_cents: number;
          total_cents: number;
          commission_rate_bps: number;
          commission_amount_cents: number;
          currency: string;
          delivery_location_id: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "orders_buyer_id_fkey";
            columns: ["buyer_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_seller_profile_id_fkey";
            columns: ["seller_profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_business_id_fkey";
            columns: ["business_id"];
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };

      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          title_snapshot: string;
          price_cents_snapshot: number;
          quantity: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };

      payments: {
        Row: {
          id: string;
          order_id: string;
          provider_id: string | null;
          provider_reference: string | null;
          method: PaymentMethod;
          status: PaymentStatus;
          amount_cents: number;
          currency: string;
          raw_payload: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };

      commissions: {
        Row: {
          id: string;
          order_id: string;
          seller_type: SellerType;
          rate_bps: number;
          base_amount_cents: number;
          commission_amount_cents: number;
          settlement_status: CommissionSettlementStatus;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "commissions_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };

      // Written to only by create_order()/confirm_collection() (both
      // SECURITY DEFINER); collection_code is additionally excluded from
      // this project's own column-level SELECT grant for `authenticated`
      // (see the migration) — reachable only via get_my_collection_code().
      // It is still typed here (rather than omitted) so code that reads
      // the other columns has an accurate Row shape; nothing in this
      // codebase should ever read .collection_code directly off a normal
      // client query.
      collection_confirmations: {
        Row: {
          id: string;
          order_id: string;
          collection_code: string;
          code_generated_at: string;
          confirmed_by: string | null;
          confirmed_at: string | null;
          buyer_present: boolean;
          notes: string | null;
          failed_attempts: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "collection_confirmations_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };

      // Audit/visibility snapshot only — never the authoritative
      // eligibility gate (that's evaluate_cash_eligibility(), evaluated
      // fresh server-side every time it matters). See
      // src/server/cash-eligibility/evaluateCashEligibility.ts.
      seller_cash_status: {
        Row: {
          id: string;
          seller_type: SellerType;
          seller_profile_id: string | null;
          business_id: string | null;
          is_eligible: boolean;
          failed_criteria: string[];
          evaluated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      // Singleton (id is always `true`) — the platform-wide cash
      // kill-switch. Publicly readable (the checkout UI needs it to
      // decide whether to even offer cash); writable only server-side.
      cash_settings: {
        Row: {
          id: boolean;
          is_enabled: boolean;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      transaction_events: {
        Row: {
          id: string;
          order_id: string | null;
          entity_type: string;
          entity_id: string;
          event_type: string;
          actor_type: string;
          actor_id: string | null;
          payload: Record<string, unknown>;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "transaction_events_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };

      // Mirrors payment_providers exactly (see
      // 20260920090400_commerce_config.sql) — publicly readable when
      // active, writable only server-side. Seeded with a single 'mock'
      // row (supabase/seed.sql); a real courier is enabled the same way
      // a real payment provider would be, by inserting/activating its
      // row once its adapter exists.
      delivery_providers: {
        Row: {
          id: string;
          slug: string;
          name: string;
          is_active: boolean;
          config: Record<string, unknown>;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      // Phase 7C. Append-only history, mirroring commission_rates —
      // "current" = the latest row by effective_from. Admin-only SELECT
      // (delivery_markup_settings_select_admin); the only write path is
      // update_delivery_markup_setting() (service-role/admin-checked
      // internally). quoteService.ts reads this via the admin client,
      // bypassing RLS the same way every other admin-only config table
      // in this schema is read server-side.
      delivery_markup_settings: {
        Row: {
          id: string;
          markup_percentage_bps: number;
          changed_by: string | null;
          effective_from: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "delivery_markup_settings_changed_by_fkey";
            columns: ["changed_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      // Phase 7A. SELECT-only for `authenticated` (own quotes via
      // requested_by, or once attached, the order's own buyer — see
      // 20260930090000_delivery_quoting_booking.sql); every write goes
      // through the service-role client from
      // src/server/delivery/quoteService.ts, mirroring the
      // orders/payments/commissions "money-moving tables get no direct
      // client write access" convention (DECISIONS.md) — a delivery
      // price is exactly that. raw_response is internal audit data,
      // never selected back out to a browser response (see
      // BuyerDeliveryQuote in quoteService.ts, which carries none of
      // requested_by/product_id/pickup_location_id/dropoff_location_id/
      // provider_quote_ref/raw_response).
      delivery_quotes: {
        Row: {
          id: string;
          order_id: string | null;
          requested_by: string | null;
          product_id: string | null;
          pickup_location_id: string;
          dropoff_location_id: string;
          provider_id: string;
          service_level: DeliveryServiceLevel;
          // Phase 7C: price_cents is the buyer-facing quote (provider cost
          // + markup) — unchanged meaning from Phase 7A. The three new
          // columns are the breakdown behind it; never selected back out
          // to the browser (see BuyerDeliveryQuote in quoteService.ts,
          // same treatment as raw_response above).
          price_cents: number;
          provider_cost_cents: number;
          markup_percentage_bps: number;
          markup_amount_cents: number;
          currency: string;
          eta_min_minutes: number | null;
          eta_max_minutes: number | null;
          provider_quote_ref: string;
          raw_response: Record<string, unknown> | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          order_id?: string | null;
          requested_by?: string | null;
          product_id?: string | null;
          pickup_location_id: string;
          dropoff_location_id: string;
          provider_id: string;
          service_level: DeliveryServiceLevel;
          price_cents: number;
          provider_cost_cents: number;
          markup_percentage_bps: number;
          markup_amount_cents: number;
          currency?: string;
          eta_min_minutes?: number | null;
          eta_max_minutes?: number | null;
          provider_quote_ref: string;
          raw_response?: Record<string, unknown> | null;
          expires_at: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "delivery_quotes_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "delivery_quotes_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "delivery_quotes_provider_id_fkey";
            columns: ["provider_id"];
            referencedRelation: "delivery_providers";
            referencedColumns: ["id"];
          },
        ];
      };

      // Phase 7A. Written only by src/server/delivery/bookingService.ts
      // (service-role client) — the reserve-then-book pattern documented
      // there. order_id is unique: at most one delivery_orders row per
      // order, ever (the DB constraint, not just application logic, is
      // what makes the booking idempotency guard race-safe).
      delivery_orders: {
        Row: {
          id: string;
          order_id: string;
          quote_id: string | null;
          provider_id: string;
          provider_tracking_ref: string | null;
          status: DeliveryOrderStatus;
          // Phase 7B: when trackingService.ts last actually polled the
          // provider (regardless of whether the status changed) —
          // distinct from updated_at, which only changes when the status
          // itself does. Drives the polling cooldown.
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          order_id: string;
          quote_id?: string | null;
          provider_id: string;
          provider_tracking_ref?: string | null;
          status?: DeliveryOrderStatus;
        };
        Update: Partial<{
          provider_tracking_ref: string | null;
          status: DeliveryOrderStatus;
          last_synced_at: string | null;
        }>;
        Relationships: [
          {
            foreignKeyName: "delivery_orders_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "delivery_orders_quote_id_fkey";
            columns: ["quote_id"];
            referencedRelation: "delivery_quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "delivery_orders_provider_id_fkey";
            columns: ["provider_id"];
            referencedRelation: "delivery_providers";
            referencedColumns: ["id"];
          },
        ];
      };

      // Phase 7B: the provider-webhook idempotency foundation — no
      // webhook route reads/writes this yet (see
      // 20261001090000_delivery_reliability.sql), so Insert/Update are
      // typed `never` the same way orders/payments/etc. are: the only
      // sanctioned write is record_provider_event() (service_role-only),
      // never a raw client insert, and there is no client-side read path
      // either (RLS enables row security with zero policies for
      // anon/authenticated).
      delivery_provider_events: {
        Row: {
          id: string;
          provider_id: string;
          provider_event_id: string;
          event_type: string;
          delivery_order_id: string | null;
          payload: Record<string, unknown>;
          received_at: string;
          processed_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "delivery_provider_events_provider_id_fkey";
            columns: ["provider_id"];
            referencedRelation: "delivery_providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "delivery_provider_events_delivery_order_id_fkey";
            columns: ["delivery_order_id"];
            referencedRelation: "delivery_orders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      profiles_public: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
          role: UserRole;
          account_verification: VerificationStatus;
          rating_average: number | null;
          rating_count: number;
          created_at: string;
        };
        Relationships: [];
      };
      businesses_public: {
        Row: {
          id: string;
          business_name: string;
          slug: string;
          logo_url: string | null;
          description: string | null;
          verification_status: VerificationStatus;
          rating_average: number | null;
          rating_count: number;
          created_at: string;
        };
        Relationships: [];
      };
      product_locations_public: {
        Row: {
          product_id: string;
          suburb: string | null;
          city: string | null;
          province: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "product_locations_public_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      search_products: {
        Args: {
          search_term?: string | null;
          category_ids?: string[] | null;
          min_price_cents?: number | null;
          max_price_cents?: number | null;
          condition_filter?: ProductCondition | null;
          collection_only?: boolean | null;
          delivery_only?: boolean | null;
          sort_key?: string | null;
          page_size?: number | null;
          page_offset?: number | null;
        };
        Returns: {
          id: string;
          title: string;
          price_cents: number;
          currency: string;
          condition: ProductCondition;
          category_id: string;
          collection_available: boolean;
          delivery_available: boolean;
          created_at: string;
          cover_image_path: string | null;
          total_count: number;
        }[];
      };
      // SECURITY DEFINER — unlike search_products(), this reads
      // `locations` rows the calling role has no SELECT grant on (see
      // 20260923090000_nearby_search.sql) and returns only the
      // derived, public-safe fields below; it never returns latitude,
      // longitude, or a location id.
      search_nearby_products: {
        Args: {
          buyer_lat: number;
          buyer_lng: number;
          radius_km?: number | null;
          category_ids?: string[] | null;
          min_price_cents?: number | null;
          max_price_cents?: number | null;
          condition_filter?: ProductCondition | null;
          collection_only?: boolean | null;
          delivery_only?: boolean | null;
          sort_key?: string | null;
          page_size?: number | null;
          page_offset?: number | null;
        };
        Returns: {
          id: string;
          title: string;
          price_cents: number;
          currency: string;
          condition: ProductCondition;
          category_id: string;
          collection_available: boolean;
          delivery_available: boolean;
          created_at: string;
          cover_image_path: string | null;
          distance_km: number;
          suburb: string | null;
          city: string | null;
          total_count: number;
        }[];
      };
      // SECURITY DEFINER — needed because no INSERT policy exists on
      // orders/order_items/payments/commissions/transaction_events for
      // `authenticated` (server-side-only writes, by design) and a buyer
      // has no ownership-based UPDATE grant on a product they don't own.
      // Every value it writes is derived inside the function body from
      // auth.uid() and the product row — see
      // 20260925090000_orders_checkout.sql. Phase 5: also raises
      // "Account verification required before purchasing." up front if
      // the caller isn't fully verified (see can_transact() below) —
      // this is unconditional, not something a client can influence via
      // any argument.
      create_order: {
        Args: {
          p_product_id: string;
          p_fulfilment_type: FulfilmentType;
          // Defaults to 'online' in the database — omit for any existing
          // (pre-Phase-4C) caller. See
          // 20260927090000_cash_collection_transactions.sql.
          p_payment_method?: PaymentMethod;
          // Phase 7A: required (server-side, not just here) when
          // p_fulfilment_type is 'delivery' — the id of a delivery_quotes
          // row this same buyer already fetched via
          // fetchDeliveryQuotesForProduct(). Must be null/omitted for
          // 'collection'. See
          // 20260930090000_delivery_quoting_booking.sql for everything
          // this value is revalidated against server-side — it is never
          // trusted to actually mean what the client claims.
          p_delivery_quote_id?: string | null;
        };
        Returns: {
          order_id: string;
          order_reference: string;
        }[];
      };
      // Phase 5 — the single reusable "am I allowed to transact" check:
      // confirmed email AND confirmed phone (live from auth.users) AND
      // latest identity_verifications status = 'verified'. Never takes a
      // parameter — always answers for the caller only, so it's safe to
      // call directly from the client (e.g. the account/checkout/sell UI
      // deciding what to show), never a privacy leak. The actual
      // enforcement lives in create_order()/the products publish
      // trigger, not here — this is the same check, exposed for display.
      can_transact: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      // SECURITY DEFINER, admin-only (checked internally via is_admin() —
      // EXECUTE is granted broadly to `authenticated` since there's no
      // separate Postgres role for "admin"). State-machine-safe: only a
      // currently-'pending' submission can be decided. Always sets
      // reviewed_by from auth.uid(), never from a parameter. See
      // 20260928090000_identity_account_verification.sql.
      review_identity_verification: {
        Args: {
          p_submission_id: string;
          p_decision: "verified" | "rejected";
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      // Phase 6 — identical pattern to review_identity_verification(),
      // for business_verifications instead. See
      // 20260929090000_business_onboarding_storefront.sql.
      review_business_verification: {
        Args: {
          p_submission_id: string;
          p_decision: "verified" | "rejected";
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      // Phase 7C. Admin-only (is_admin() checked internally, same
      // pattern as review_identity_verification()). Always inserts a new
      // delivery_markup_settings row (append-only) with changed_by =
      // auth.uid() — never a parameter, never updates an existing row.
      update_delivery_markup_setting: {
        Args: { p_markup_percentage_bps: number };
        Returns: undefined;
      };
      // Public-safe wrapper around evaluate_cash_eligibility() — returns
      // only a boolean, never the internal failed_criteria. The checkout
      // UI's "should I offer Cash on collection" check.
      is_seller_cash_eligible: {
        Args: {
          p_seller_type: SellerType;
          p_seller_profile_id: string | null;
          p_business_id: string | null;
        };
        Returns: boolean;
      };
      // SECURITY DEFINER — seller-only; re-validates ownership, state,
      // global switch, and fresh eligibility from auth.uid(), never from
      // a parameter. pending_payment -> confirmed.
      accept_cash_order: {
        Args: { p_order_id: string };
        Returns: undefined;
      };
      // SECURITY DEFINER — seller-only. pending_payment -> cancelled,
      // releases the listing back to 'published', voids the commission
      // obligation (settlement_status -> 'settled', never
      // 'collected_via_payment' — no cash was ever received).
      decline_cash_order: {
        Args: { p_order_id: string; p_reason?: string | null };
        Returns: undefined;
      };
      // SECURITY DEFINER — seller-only. Validates the buyer-provided
      // code against the stored one (never exposed to the seller
      // directly — see get_my_collection_code()), with a 5-failed-
      // attempt lockout. 'completed' | 'incorrect_code' | 'locked' |
      // 'already_completed' — never a raised exception for a wrong code,
      // only for auth/ownership/state failures.
      confirm_collection: {
        Args: { p_order_id: string; p_code: string };
        Returns: { outcome: string }[];
      };
      // SECURITY DEFINER — the only sanctioned way to read a raw
      // collection_code; buyer-only, re-validated from auth.uid() +
      // orders.buyer_id every call.
      get_my_collection_code: {
        Args: { p_order_id: string };
        Returns: string;
      };
      // SECURITY DEFINER — no UPDATE policy exists on payments for
      // `authenticated`. Re-validates auth.uid()=buyer_id, order/payment
      // status server-side. See 20260926090000_payfast_payment_integration.sql.
      record_payment_attempt: {
        Args: {
          p_order_id: string;
          p_provider_reference: string;
        };
        Returns: undefined;
      };
      // NOT SECURITY DEFINER — EXECUTE is restricted to service_role
      // only (see the migration); called exclusively by the PayFast
      // webhook route via the admin/service-role client, never via a
      // normal authenticated session.
      process_payfast_itn: {
        Args: {
          p_order_id: string;
          p_provider_reference: string;
          p_status: string;
          p_amount_cents: number;
        };
        Returns: {
          outcome: string;
        }[];
      };
      // Phase 7A. service_role-only (see
      // 20260930090000_delivery_quoting_booking.sql) — called from
      // src/server/delivery/bookingService.ts before the provider is
      // contacted. Returns the new delivery_orders.id on success, or
      // null if one already exists for this order (the idempotency
      // guard, backed by delivery_orders.order_id's UNIQUE constraint).
      reserve_delivery_order: {
        Args: {
          p_order_id: string;
          p_quote_id: string;
          p_provider_id: string;
        };
        Returns: string | null;
      };
      // Phase 7A. service_role-only — called after the provider call
      // returns (success or failure). 'booked' additionally advances
      // the order from 'confirmed' to 'awaiting_delivery'.
      record_delivery_booking: {
        Args: {
          p_delivery_order_id: string;
          p_provider_tracking_ref: string | null;
          p_status: DeliveryOrderStatus;
        };
        Returns: undefined;
      };
      // Phase 7A/7B. service_role-only — called by
      // src/server/delivery/trackingService.ts after polling
      // DeliveryProvider.getStatus(). Phase 7B added a transition guard
      // (is_valid_delivery_status_transition()) and always bumps
      // last_synced_at, even when p_status equals the current status —
      // that's what drives the polling cooldown.
      sync_delivery_status: {
        Args: {
          p_order_id: string;
          p_status: DeliveryOrderStatus;
        };
        Returns: undefined;
      };
      // Phase 7B. service_role-only — the polling-cooldown fallback for
      // when provider.getStatus() itself throws: bumps last_synced_at
      // without touching status, so a down provider is still rate-limited.
      record_delivery_sync_attempt: {
        Args: { p_order_id: string };
        Returns: undefined;
      };
      // Phase 7B. service_role-only — the provider-webhook idempotency
      // check (20261001090000_delivery_reliability.sql): insert-on-
      // conflict-do-nothing against (provider_id, provider_event_id).
      // Returns the new event's id, or null if this exact
      // (provider_id, provider_event_id) pair was already recorded — a
      // future webhook route treats null as "safe to ignore", not an
      // error. Nothing calls this yet; no webhook route exists.
      record_provider_event: {
        Args: {
          p_provider_id: string;
          p_provider_event_id: string;
          p_event_type: string;
          p_delivery_order_id: string | null;
          p_payload?: Record<string, unknown>;
        };
        Returns: string | null;
      };
      // Phase 7B. Buyer-only (auth.uid() = orders.buyer_id, re-checked
      // inside the function, never trusted from a parameter) — cancels a
      // delivery order that is still pending_payment with no
      // delivery_orders row yet. No refund logic: payment never
      // completed, so there is nothing to refund. See
      // 20261001090000_delivery_reliability.sql for the full
      // authorization/restoration logic.
      cancel_pending_delivery_order: {
        Args: { p_order_id: string };
        Returns: undefined;
      };
      // Phase 7B. Granted broadly to `authenticated`, is_admin() checked
      // internally (same pattern as review_identity_verification()) —
      // read-only, admin visibility into delivery_orders stuck at
      // 'pending' past p_older_than_minutes. Never mutates anything, and
      // deliberately excludes pickup/dropoff coordinates and raw
      // provider responses.
      list_stuck_pending_deliveries: {
        Args: { p_older_than_minutes?: number };
        Returns: {
          delivery_order_id: string;
          order_id: string;
          order_reference: string;
          provider_name: string | null;
          quote_id: string | null;
          service_level: DeliveryServiceLevel | null;
          price_cents: number | null;
          status: DeliveryOrderStatus;
          provider_tracking_ref: string | null;
          created_at: string;
          updated_at: string;
          age_minutes: number;
        }[];
      };
      // Phase 7D. Granted broadly to `authenticated`, is_admin() checked
      // internally (same pattern as list_stuck_pending_deliveries()) —
      // the only sanctioned read of provider_delivery_cost_cents/
      // delivery_markup_percentage_bps/delivery_markup_amount_cents,
      // now that those columns are excluded from orders' own
      // column-level SELECT grant for `authenticated` (see
      // 20261003090000_delivery_financial_privacy.sql). Read-only; every
      // filter is optional (null = match everything).
      list_delivery_financial_transactions: {
        Args: {
          p_fulfilment_type?: FulfilmentType | null;
          p_delivery_status?: DeliveryOrderStatus | null;
          p_payment_status?: PaymentStatus | null;
          p_provider_slug?: string | null;
          p_created_after?: string | null;
          p_created_before?: string | null;
          p_limit?: number;
        };
        Returns: {
          order_id: string;
          order_reference: string;
          created_at: string;
          fulfilment_type: FulfilmentType;
          provider_slug: string | null;
          provider_delivery_cost_cents: number;
          buyer_delivery_fee_cents: number;
          delivery_markup_percentage_bps: number;
          delivery_markup_amount_cents: number;
          delivery_margin_cents: number;
          delivery_status: DeliveryOrderStatus | null;
          payment_status: PaymentStatus | null;
        }[];
      };
    };
    Enums: {
      user_role: UserRole;
      verification_status: VerificationStatus;
      account_standing: AccountStanding;
      seller_type: SellerType;
      product_status: ProductStatus;
      product_condition: ProductCondition;
      fulfilment_type: FulfilmentType;
      payment_method: PaymentMethod;
      order_status: OrderStatus;
      payment_status: PaymentStatus;
      commission_settlement_status: CommissionSettlementStatus;
      delivery_service_level: DeliveryServiceLevel;
      delivery_order_status: DeliveryOrderStatus;
    };
  };
};
