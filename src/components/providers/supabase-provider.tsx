"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const isConfigured = isSupabaseConfigured();
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("Supabase getSession failed:", err);
        if (mounted) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, isConfigured]);

  const value: AuthContextValue = {
    user,
    session,
    loading,
    isConfigured,
    signOut: async () => {
      if (!isConfigured) return;
      await supabase.auth.signOut();
    },
    refreshSession: async () => {
      if (!isConfigured) return;
      const { data } = await supabase.auth.refreshSession();
      setSession(data.session);
      setUser(data.session?.user ?? null);
    },
  };

  return (
    <AuthContext.Provider value={value}>
      {!isConfigured && (
        <aside
          role="alert"
          className="border-b border-amber-500/30 bg-amber-950/40 px-4 py-2.5 text-center text-xs text-amber-200 backdrop-blur"
        >
          <span className="font-semibold text-amber-400">⚠️ Supabase not configured:</span>{" "}
          Add your <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-amber-300">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-amber-300">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-amber-300">.env.local</code> and restart the dev server.
        </aside>
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within SupabaseProvider");
  return ctx;
}
