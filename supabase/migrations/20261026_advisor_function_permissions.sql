begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- These two classification write RPCs have no caller validation and are
-- exclusively used by privileged workers. Revoke the direct Supabase grants
-- as well as PUBLIC, preserving the existing service-role path.
revoke execute on function public.apply_keyword_codex_classifications(jsonb)
  from public, anon, authenticated;
revoke execute on function public.claim_keyword_classification_batch(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.apply_keyword_codex_classifications(jsonb)
  to service_role;
grant execute on function public.claim_keyword_classification_batch(uuid, integer)
  to service_role;

commit;
