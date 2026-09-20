/**
 * Hand-maintained until the real types can be generated from a running
 * database:
 *
 *   npm run db:types   (requires `supabase start` or a linked project)
 *
 * No Docker/live Supabase project has been available in this environment
 * to run that command yet, so only the tables application code actually
 * queries (currently: profiles) are typed here, transcribed carefully
 * from supabase/migrations/. Once `db:types` has been run for real,
 * replace this whole file with its output and stop hand-editing it.
 */

type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";
type AccountStanding = "good" | "warned" | "suspended";
type UserRole = "parent" | "admin";

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      verification_status: VerificationStatus;
      account_standing: AccountStanding;
    };
  };
};
