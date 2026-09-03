# Supabase audit notes

`schema.sql` is a historical partial snapshot and cannot reproduce the live database. The live project currently exposes substantially more tables and RPCs than this file defines.

Before the next production database change:

1. Export the live schema and RLS policies with the Supabase CLI into versioned migrations.
2. Review and apply `migrations/20260903_audit_hardening.sql`. Duplicate usernames, memberships, access grants, or null claim ownership fields still stop the migration. Legitimate historical same-day claims are preserved; a serialized database trigger prevents new duplicates without deleting old tracking data.
3. Generate TypeScript database types from the linked Supabase project; `lib/supabase.ts` is incomplete and should not be treated as authoritative.
4. Verify authenticated RLS with three test accounts: `normal`, `admin`, and `super`. In particular, a normal account must not be able to select site rows outside its `user_site_access` plus focus-level-3 scope, or write another user's claims/dismissals.

The application uses the service-role key in server routes and cron jobs. Never expose that key to the browser, logs, tracked settings files, or command allowlists.
