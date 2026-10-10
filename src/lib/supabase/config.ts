export function sanitizeSupabaseUrl(rawUrl?: string | null): string {
  if (!rawUrl) return "";
  let url = rawUrl.trim();
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/rest\/v1\/?$/, "");
  return url.replace(/\/+$/, "");
}

export function isSupabaseConfigured(): boolean {
  const url = sanitizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(
    url &&
      anonKey &&
      url.length > 0 &&
      anonKey.length > 0 &&
      !url.includes("YOUR_PROJECT") &&
      !url.includes("placeholder") &&
      !anonKey.includes("your_anon_key")
  );
}

export function getSupabaseCredentials(): { url: string; anonKey: string } {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  const url = sanitizeSupabaseUrl(rawUrl);
  const anonKey = rawKey && rawKey.length > 0 ? rawKey : "placeholder-anon-key";

  return {
    url: url && url.length > 0 ? url : "https://placeholder-project.supabase.co",
    anonKey,
  };
}
