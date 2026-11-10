import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Secret-key client (Supabase's new `sb_secret_...` keys, which replaced the legacy service_role key): bypasses RLS. Server-only (rate-limit counters, saving plans).
 * Returns null when Supabase isn't configured, so local dev works without it.
 */
let client: SupabaseClient | null | undefined;
export function getAdminClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}
