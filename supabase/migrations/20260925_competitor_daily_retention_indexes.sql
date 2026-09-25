-- Competitor Daily keeps raw daily detail for 40 days. These indexes let the
-- daily GitHub Actions cleanup remove one expired date partition at a time.
begin;

create index if not exists idx_raw_keywords_content_date
  on public.raw_keywords (content_date);

create index if not exists idx_rank_changes_stat_date
  on public.rank_changes (stat_date);

create index if not exists idx_site_keyword_ranks_stat_date
  on public.site_keyword_ranks (stat_date);

commit;
