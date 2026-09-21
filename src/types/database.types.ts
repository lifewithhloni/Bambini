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
      // 20260925090000_orders_checkout.sql.
      create_order: {
        Args: {
          p_product_id: string;
          p_fulfilment_type: FulfilmentType;
          // Defaults to 'online' in the database — omit for any existing
          // (pre-Phase-4C) caller. See
          // 20260927090000_cash_collection_transactions.sql.
          p_payment_method?: PaymentMethod;
        };
        Returns: {
          order_id: string;
          order_reference: string;
        }[];
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
    };
  };
};
