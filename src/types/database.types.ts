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
// The DB enum also has unused legacy labels 'sold'/'removed' (see
// DECISIONS.md) — the app never reads or writes them, so they're
// deliberately left out of this narrower, app-facing type.
type ProductStatus = "draft" | "published" | "archived";
type ProductCondition = "like_new" | "excellent" | "good" | "fair";

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
    };
    Enums: {
      user_role: UserRole;
      verification_status: VerificationStatus;
      account_standing: AccountStanding;
      seller_type: SellerType;
      product_status: ProductStatus;
      product_condition: ProductCondition;
    };
  };
};
