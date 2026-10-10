# Supabase setup

1. Create a project at https://supabase.com
2. Open **SQL Editor** and run [`migrations/001_initial_schema.sql`](migrations/001_initial_schema.sql)
3. Copy the project URL and anon key into `.env.local`
4. Optional: Authentication → Providers → Email → disable **Confirm email** for local demos
5. Confirm tables appear under **Database → Tables** and are listed in the `supabase_realtime` publication
