begin;
-- Aggregate inside Postgres instead of transferring a month of raw keywords
-- or silently truncating daily rank_changes at the REST row limit.
create or replace function public.environment_rank_counts(p_date date)
returns table(site_id uuid, up_count bigint, down_count bigint)
language sql stable security invoker set search_path = public
as $$
  select r.site_id,
    count(*) filter (where r.type = 'rankup'),
    count(*) filter (where r.type = 'rankdown')
  from public.rank_changes r where r.stat_date = p_date
  group by r.site_id;
$$;

create or replace function public.environment_content_counts(p_since date, p_until date)
returns table(site_id uuid, game_count bigint, app_count bigint)
language sql stable security invoker set search_path = public
as $$
  select k.site_id,
    count(*) filter (where k.content_type = 'game'),
    count(*) filter (where k.content_type = 'app')
  from public.raw_keywords k
  where k.content_date >= p_since and k.content_date <= p_until
    and k.content_type in ('game', 'app')
  group by k.site_id;
$$;
revoke all on function public.environment_rank_counts(date),
  public.environment_content_counts(date,date) from public, anon, authenticated;
grant execute on function public.environment_rank_counts(date),
  public.environment_content_counts(date,date) to service_role;
commit;
