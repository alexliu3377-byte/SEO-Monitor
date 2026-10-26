-- Explicit, audited service-only RPC list. These have no RLS-policy
-- dependencies; browser features call authenticated server routes, not RPCs.
-- No schema-wide/default grants, function bodies, or data are changed.
begin;
revoke execute on function
  public.cleanup_trend_discovery_data(),
  public.create_app_update_target(text,text,text,text,text,text,uuid),
  public.get_feedback_requests_page(text,uuid,text,text,integer,integer),
  public.get_group_tracking_detail_page(uuid,date,date,text,uuid,integer,integer,integer,integer),
  public.get_group_tracking_outcomes_page(uuid,uuid,uuid,text,text,text,text,text,text,text,integer,integer),
  public.get_latest_group_tracking_records(uuid,integer,integer),
  public.invalidate_group_tracking_paged_cache(uuid),
  public.keyword_classification_summary(),
  public.refresh_trend_discovery_terms(),
  public.release_keyword_classification_batch(uuid),
  public.replace_group_tracking_paged_cache(uuid,jsonb,jsonb,timestamptz),
  public.review_app_update_release(uuid,text,uuid),
  public.prevent_duplicate_active_group_claim(),
  public.prevent_excluded_keyword_volume(),
  public.sync_development_request_message_stats()
from public, anon, authenticated;

grant execute on function
  public.cleanup_trend_discovery_data(),
  public.create_app_update_target(text,text,text,text,text,text,uuid),
  public.get_feedback_requests_page(text,uuid,text,text,integer,integer),
  public.get_group_tracking_detail_page(uuid,date,date,text,uuid,integer,integer,integer,integer),
  public.get_group_tracking_outcomes_page(uuid,uuid,uuid,text,text,text,text,text,text,text,integer,integer),
  public.get_latest_group_tracking_records(uuid,integer,integer),
  public.invalidate_group_tracking_paged_cache(uuid),
  public.keyword_classification_summary(),
  public.refresh_trend_discovery_terms(),
  public.release_keyword_classification_batch(uuid),
  public.replace_group_tracking_paged_cache(uuid,jsonb,jsonb,timestamptz),
  public.review_app_update_release(uuid,text,uuid),
  public.prevent_duplicate_active_group_claim(),
  public.prevent_excluded_keyword_volume(),
  public.sync_development_request_message_stats()
to service_role;
commit;
