import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

/**
 * Creates a server-only administrative Supabase client using the service-role key.
 *
 * SECURITY INVARIANTS:
 * - NEVER import this module in client components or browser bundles.
 * - Service-role privileges bypass PostgreSQL Row Level Security (RLS).
 * - Persisted sessions, token refresh, and URL session detection are disabled.
 * - Strictly intended for internal server pipelines (e.g. OAuth state management, credential encryption).
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin configuration. Ensure SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are configured in server environment."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
