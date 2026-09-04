# Supabase audit notes

`schema.sql` is a historical partial snapshot and cannot reproduce the live database. The live project currently exposes substantially more tables and RPCs than this file defines.

Before the next production database change:

1. Export the live schema and RLS policies with the Supabase CLI into versioned migrations.
2. Review and apply `migrations/20260903_audit_hardening.sql`. Duplicate usernames, memberships, access grants, or null claim ownership fields still stop the migration. Legitimate historical same-day claims are preserved; a serialized database trigger prevents new duplicates without deleting old tracking data.
3. Generate TypeScript database types from the linked Supabase project; `lib/supabase.ts` is incomplete and should not be treated as authoritative.
4. Verify authenticated RLS with three test accounts: `normal`, `admin`, and `super`. In particular, a normal account must not be able to select site rows outside its `user_site_access` plus focus-level-3 scope, or write another user's claims/dismissals.

## Group tracking paged cache

Apply `migrations/20260904_group_tracking_paged_cache.sql` before deploying the matching application change. It creates service-role-only cache tables and RPCs; it does not delete the legacy `group_tracking_cache` data. After applying it, manually run **Group Tracking Cache Refresh** once so all groups receive paged rows and precomputed monthly summaries immediately. Until that first refresh, the application safely falls back to the legacy cache and remains slower.

`migrations/20260904_remove_search_activity_logs.sql` intentionally deletes only `activity_log` rows whose type is `search` (dependent site-log rows follow the existing foreign-key behavior) and adds a check constraint so an older browser deployment cannot recreate them. It does not affect automatic or manual crawl logs.

## Employee offboarding

Apply `migrations/20260904_user_offboarding.sql` before using **办理离职** in account settings. The migration adds an active-status flag and a service-role-only transactional RPC. Offboarding disables the profile, removes task-group memberships and site grants, and dismisses pending claims so they do not block reassignment. It deliberately preserves `user_profiles`, submitted claims, tracking rows, and usernames for historical reports. The application also bans the Supabase Auth user as defense in depth and rejects disabled profiles in both the login route and request proxy.

The application uses the service-role key in server routes and cron jobs. Never expose that key to the browser, logs, tracked settings files, or command allowlists.
