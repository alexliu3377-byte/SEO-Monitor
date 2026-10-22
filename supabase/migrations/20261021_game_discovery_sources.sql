begin;
create table if not exists public.game_discovery_cache (
  dataset text primary key check (dataset in ('momo_rising','momo_popularity','momo_bestseller','momo_bestplay','momo_hot_search','momo_ip','momo_hot_words','wechat_popularity','wechat_bestseller','wechat_bestplay')),
  source_date date,
  collected_at timestamptz not null,
  source_modified_at timestamptz,
  item_count integer not null check (item_count between 1 and 100),
  check ((dataset like 'momo_%' and source_date is not null and item_count<=10) or (dataset like 'wechat_%' and source_date is null))
);
create table if not exists public.game_discovery_cache_rows (
  dataset text not null references public.game_discovery_cache(dataset) on delete cascade,
  position integer not null check (position between 1 and 100),
  source_id text not null check (length(btrim(source_id)) between 1 and 240),
  title text not null check (length(btrim(title)) between 1 and 240),
  summary text check (summary is null or length(summary)<=500),
  url text check (url is null or (length(url)<=2048 and url ~ '^https://www\.momorank\.com/games/[0-9]+([?].*)?$')),
  metric text check (metric is null or length(metric)<=100),
  change text check (change is null or length(change)<=100),
  tags text[] not null default '{}' check (cardinality(tags)<=8),
  primary key(dataset,position), unique(dataset,source_id)
);
alter table public.game_discovery_cache enable row level security;
alter table public.game_discovery_cache_rows enable row level security;
revoke all on public.game_discovery_cache,public.game_discovery_cache_rows from public,anon,authenticated;
grant all on public.game_discovery_cache,public.game_discovery_cache_rows to service_role;

create or replace function public.replace_game_discovery_cache(p_dataset text,p_source_date date,p_collected_at timestamptz,p_source_modified_at timestamptz,p_items jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if p_dataset is null or p_dataset not in ('momo_rising','momo_popularity','momo_bestseller','momo_bestplay','momo_hot_search','momo_ip','momo_hot_words','wechat_popularity','wechat_bestseller','wechat_bestplay')
    or p_collected_at is null or p_collected_at>now()+interval '5 minutes' or jsonb_typeof(p_items) is distinct from 'array'
    then raise exception 'Invalid discovery collection'; end if;
  v_count:=jsonb_array_length(p_items);
  if v_count<1 or v_count>(case when p_dataset like 'momo_%' then 10 else 100 end)
    or (p_dataset like 'momo_%' and p_source_date is null) or (p_dataset like 'wechat_%' and p_source_date is not null)
    or p_source_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Invalid source scope/date'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as r(position int,"sourceId" text,title text)
    where r.position is null or r."sourceId" is null or r.title is null)
    or (select min(r.position)<>1 or max(r.position)<>v_count or count(distinct r.position)<>v_count or count(distinct r."sourceId")<>v_count
      from jsonb_to_recordset(p_items) as r(position int,"sourceId" text)) then raise exception 'Incomplete discovery rows'; end if;
  if p_dataset like 'wechat_%' and exists(select 1 from jsonb_to_recordset(p_items) as r("sourceId" text,url text)
    where r."sourceId" !~ '^wx[a-f0-9]{16}$' or r.url is not null) then raise exception 'Invalid WeChat identity'; end if;
  perform pg_advisory_xact_lock(hashtext('game_discovery_cache:'||p_dataset));
  if exists(select 1 from public.game_discovery_cache where dataset=p_dataset
    and (collected_at>=p_collected_at or source_date>p_source_date)) then return 0; end if;
  insert into public.game_discovery_cache values(p_dataset,p_source_date,p_collected_at,p_source_modified_at,v_count)
    on conflict(dataset) do update set source_date=excluded.source_date,collected_at=excluded.collected_at,
      source_modified_at=excluded.source_modified_at,item_count=excluded.item_count;
  delete from public.game_discovery_cache_rows where dataset=p_dataset;
  insert into public.game_discovery_cache_rows(dataset,position,source_id,title,summary,url,metric,change,tags)
    select p_dataset,r.position,r."sourceId",r.title,r.summary,r.url,r.metric,r.change,coalesce(r.tags,'{}')
    from jsonb_to_recordset(p_items) as r(position int,"sourceId" text,title text,summary text,url text,metric text,change text,tags text[]);
  return v_count;
end;
$$;
revoke all on function public.replace_game_discovery_cache(text,date,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.replace_game_discovery_cache(text,date,timestamptz,timestamptz,jsonb) to service_role;

-- Metadata and page rows must come from the SAME database snapshot. Two HTTP
-- reads could mix yesterday's date with rows published between the reads.
create or replace function public.get_game_discovery_page(p_dataset text,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_page is null or p_page<1 or p_page>5 then raise exception 'Invalid page'; end if;
  return (with meta as (select * from public.game_discovery_cache where dataset=p_dataset),
    page_rows as (select position,source_id,title,summary,url,metric,change,tags from public.game_discovery_cache_rows
      where dataset=p_dataset order by position limit 20 offset (p_page-1)*20)
    select jsonb_build_object('metadata',(select to_jsonb(m)-'dataset' from meta m),
      'total',coalesce((select item_count from meta),0),
      'items',coalesce((select jsonb_agg(to_jsonb(r) order by position) from page_rows r),'[]'::jsonb)));
end;
$$;
revoke all on function public.get_game_discovery_page(text,integer) from public,anon,authenticated;
grant execute on function public.get_game_discovery_page(text,integer) to service_role;
commit;
