# Seven Stones — Crypto & Network Security Game

A minimal multiplayer arena inspired by the classic Indian game **Seven Stones (Pitthu / Lagori)**. Built as an academic project to demonstrate cryptography and network security concepts in a real application.

**Stack:** Next.js (App Router) · React · Tailwind CSS · shadcn-style UI · Supabase (Auth, Postgres, Realtime) · Vercel · GitHub

## Security features demonstrated

| Feature | How it works in the game |
|--------|---------------------------|
| **Authentication & sessions** | Supabase Auth email/password → JWT in cookies. Middleware protects `/lobby`, `/room/*`, `/game/*`. Security Lab shows user id, email, JWT expiry, and refresh. |
| **Secure room join** | Invite code + passphrase are **SHA-256 hashed in the browser**. Only hashes + salt are stored. Join RPC matches hashes; RLS blocks non-members. |
| **SHA-256 state integrity** | Every game action is append-only with `prev_hash` + `action_hash`. Lab can **Verify** the chain or **Simulate tamper** (local payload change → verification fails). |
| **E2E encrypted chat** | Room passphrase → **PBKDF2** (100k, SHA-256) → **AES-GCM**. DB stores ciphertext + IV only. Lab shows hex ciphertext vs decrypted plaintext. |

## Quick start

### 1. Clone & install

```bash
npm install
cp .env.local.example .env.local
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com)
2. Copy **Project URL** and **anon key** into `.env.local`
3. In the Supabase SQL Editor, run the full migration:

[`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)

4. Auth settings: for local demos, you can disable “Confirm email” under Authentication → Providers → Email
5. Realtime: the migration adds tables to `supabase_realtime`. Confirm under Database → Publications if needed

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Deploy (Vercel + GitHub)

1. Push this repo to GitHub
2. Import the repo in Vercel
3. Set env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy — HTTPS/TLS is provided by Vercel (transport security)

## How to play (minimal arena)

1. Sign up two accounts (two browsers / profiles)
2. Host **creates a room** (passphrase + auto invite code) and shares both out-of-band
3. Guest **joins** with invite + passphrase (hashes computed client-side)
4. Enter the **arena** — host starts the game
5. **Seekers** throw at the stack; on hit, rebuild stones while **Guardians** tag seekers
6. Seekers win by rebuilding to 7; Guardians win by tagging all seekers

## Viva / demo script (~3 minutes)

1. **Auth** — Sign in → open Security Lab → Auth tab → show JWT expiry → Refresh session → Sign out and show redirect to login
2. **Secure join** — Create room → show invite code in UI → note Lab “Invite hash in DB” → second user joins → show invite SHA-256 preview on join form → attempt opening a room URL while not a member (RLS error)
3. **Integrity** — Play a few actions → Integrity tab → Verify state (VALID) → Simulate tamper → Verify again (TAMPER DETECTED)
4. **E2E chat** — Send a message → Chat tab shows ciphertext hex → toggle Show ciphertext in chat panel → explain server never sees plaintext

## Project structure

```
src/
  app/                 # App Router pages (auth, lobby, room, game)
  components/
    arena/             # Minimal Seven Stones UI + actions
    chat/              # E2E encrypt/decrypt chat
    security-lab/      # Demo panel for viva
    rooms/             # Create / join (hashed secrets)
  lib/
    crypto/            # SHA-256, PBKDF2, AES-GCM (Web Crypto)
    game/              # Rules + hash-chain verification
    supabase/          # Clients, types, middleware helper
supabase/migrations/   # Schema, RLS, secure RPCs
```

## Hash chain formula

```
action_hash = SHA-256(
  prevHash | seq | actorId | actionType | canonicalJSON(payload) | nonce
)
```

Genesis `prevHash` is 64 zero hex digits.

## Notes for examiners

- Secrets (invite, passphrase, chat plaintext) are not written to Postgres in cleartext
- Authorization is enforced with **Row Level Security** and `security definer` RPCs
- Integrity verification is client-recomputable (transparent for demos); the server also rejects sequence / prev-hash mismatches on submit
- Transport security in production relies on **TLS** (Vercel + Supabase HTTPS)
