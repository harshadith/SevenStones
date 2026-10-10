import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabaseCredentials, isSupabaseConfigured } from "@/lib/supabase/config";

export { isSupabaseConfigured };

export function createClient() {
  const { url, anonKey } = getSupabaseCredentials();
  return createBrowserClient<Database>(url, anonKey);
}

