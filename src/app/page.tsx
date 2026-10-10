import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div className="absolute inset-0 arena-grid opacity-40" aria-hidden />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <p className="mb-3 text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          Cryptography &amp; Network Security
        </p>
        <h1 className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-[var(--fg)] sm:text-6xl">
          Seven Stones
        </h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--muted)]">
          A minimal multiplayer arena of the classic Indian game — built to
          demonstrate authentication, secure room join, SHA-256 state
          verification, and end-to-end encrypted chat.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Auth & sessions", "Supabase JWT + protected routes"],
            ["Secure room join", "SHA-256 invite & passphrase hashes"],
            ["State integrity", "Append-only action hash chain"],
            ["E2E chat", "PBKDF2 + AES-GCM in the browser"],
          ].map(([title, desc]) => (
            <li
              key={title}
              className="border-t border-[var(--border)] pt-3"
            >
              <p className="font-medium text-[var(--fg)]">{title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
