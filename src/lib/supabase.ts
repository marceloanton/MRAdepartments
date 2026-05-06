import { createClient } from "@supabase/supabase-js";

let supabase: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publicKey = publishableKey ?? anonKey;

  if (!url || !publicKey) {
    throw new Error("Supabase public environment variables are required.");
  }

  if (!supabase) {
    supabase = createClient(url, publicKey);
  }

  return supabase;
}
