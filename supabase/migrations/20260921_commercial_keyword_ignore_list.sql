-- Keep ignored commercial-keyword discoveries out of future crawl results
-- without retaining their bulky evidence rows in the review table.
begin;

create table if not exists public.commercial_keyword_ignored_terms (
  normalized_keyword text primary key
    check (char_length(normalized_keyword) between 1 and 300),
  ignored_by uuid references public.user_profiles(id) on delete set null,
  ignored_at timestamptz not null default now()
);

insert into public.commercial_keyword_ignored_terms (normalized_keyword, ignored_by, ignored_at)
select distinct on (lower(btrim(source_keyword)))
  lower(btrim(source_keyword)), reviewed_by, coalesce(reviewed_at, now())
from public.commercial_keyword_discoveries
where status = 'ignored' and btrim(source_keyword) <> ''
order by lower(btrim(source_keyword)), reviewed_at desc nulls last
on conflict (normalized_keyword) do nothing;

delete from public.commercial_keyword_discoveries where status = 'ignored';

alter table public.commercial_keyword_ignored_terms enable row level security;
revoke all on table public.commercial_keyword_ignored_terms from public, anon, authenticated;
grant all on table public.commercial_keyword_ignored_terms to service_role;

commit;
