begin;
alter table public.game_discovery_cache drop constraint game_discovery_cache_dataset_check;
alter table public.game_discovery_cache add constraint game_discovery_cache_dataset_check check (dataset in (
  'momo_overview','momo_douyin_overview','momo_rising','momo_rising_popularity','momo_rising_bestplay',
  'momo_popularity','momo_bestseller','momo_bestplay','momo_hot_search','momo_ip','momo_hot_words',
  'momo_douyin_popularity','momo_douyin_bestseller','momo_douyin_new','momo_douyin_publisher',
  'momo_douyin_rising_popularity','momo_douyin_rising_bestseller','momo_douyin_rising_new','momo_douyin_rising_publisher',
  'wechat_popularity','wechat_bestseller','wechat_bestplay'));
alter table public.game_discovery_cache add column highlights jsonb not null default '{"changes":[],"rising":[]}'::jsonb
  check (jsonb_typeof(highlights)='object' and octet_length(highlights::text)<=100000);
alter table public.game_discovery_cache_rows drop constraint game_discovery_cache_rows_url_check;
alter table public.game_discovery_cache_rows add constraint game_discovery_cache_rows_url_check
  check (url is null or (length(url)<=2048 and url ~ '^https://www\.momorank\.com/(douyin/)?games/[0-9]+([?].*)?$'));

-- V2 publishes the public page's rows and change/overview sections atomically.
-- The previous function remains available for older deployed collectors.
create or replace function public.replace_game_discovery_cache_v2(
  p_dataset text,p_source_date date,p_collected_at timestamptz,p_source_modified_at timestamptz,p_items jsonb,
  p_highlights jsonb default '{"changes":[],"rising":[]}'::jsonb
) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer; v_rising_count integer; v_douyin boolean:=p_dataset like 'momo_douyin_%';
begin
  if p_dataset is null or p_dataset not in (
    'momo_overview','momo_douyin_overview','momo_rising','momo_rising_popularity','momo_rising_bestplay',
    'momo_popularity','momo_bestseller','momo_bestplay','momo_hot_search','momo_ip','momo_hot_words',
    'momo_douyin_popularity','momo_douyin_bestseller','momo_douyin_new','momo_douyin_publisher',
    'momo_douyin_rising_popularity','momo_douyin_rising_bestseller','momo_douyin_rising_new','momo_douyin_rising_publisher',
    'wechat_popularity','wechat_bestseller','wechat_bestplay')
    or p_collected_at is null or p_collected_at>now()+interval '5 minutes' or jsonb_typeof(p_items) is distinct from 'array'
    then raise exception 'Invalid discovery collection'; end if;
  v_count:=jsonb_array_length(p_items);
  if v_count<1 or v_count>(case when p_dataset like 'momo_%' then 10 else 100 end)
    or (p_dataset like 'momo_%' and p_source_date is null) or (p_dataset like 'wechat_%' and p_source_date is not null)
    or p_source_date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'Invalid source scope/date'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as r(position int,"sourceId" text,title text,url text)
    where r.position is null or r."sourceId" is null or r.title is null
      or (r.url is not null and v_douyin<>(r.url like 'https://www.momorank.com/douyin/%')))
    or (select min(r.position)<>1 or max(r.position)<>v_count or count(distinct r.position)<>v_count or count(distinct r."sourceId")<>v_count
      from jsonb_to_recordset(p_items) as r(position int,"sourceId" text)) then raise exception 'Incomplete discovery rows'; end if;
  if p_dataset like 'wechat_%' and exists(select 1 from jsonb_to_recordset(p_items) as r("sourceId" text,url text)
    where r."sourceId" !~ '^wx[a-f0-9]{16}$' or r.url is not null) then raise exception 'Invalid WeChat identity'; end if;
  if jsonb_typeof(p_highlights) is distinct from 'object' or octet_length(p_highlights::text)>100000
    or jsonb_typeof(p_highlights->'changes') is distinct from 'array' or jsonb_typeof(p_highlights->'rising') is distinct from 'array'
    then raise exception 'Invalid highlights'; end if;
  v_rising_count:=jsonb_array_length(p_highlights->'rising');
  if jsonb_array_length(p_highlights->'changes')>4 or v_rising_count>10
    or (p_dataset not in ('momo_overview','momo_douyin_overview') and v_rising_count>0)
    or (p_dataset like 'wechat_%' and jsonb_array_length(p_highlights->'changes')>0)
    then raise exception 'Invalid highlights scope'; end if;
  if exists(select 1 from jsonb_to_recordset(p_highlights->'changes') as g(label text,items jsonb)
    where g.label is null or g.label not in ('新进榜','上升','下降','脱榜') or jsonb_typeof(g.items) is distinct from 'array')
    then raise exception 'Invalid highlight group'; end if;
  if exists(select 1 from jsonb_to_recordset(p_highlights->'changes') as g(label text,items jsonb)
    where jsonb_array_length(g.items)>10)
    or exists(select 1 from jsonb_to_recordset(p_highlights->'changes') as g(label text,items jsonb)
      cross join lateral jsonb_to_recordset(g.items) as r(title text,url text,change text)
      where r.title is null or length(btrim(r.title)) not between 1 and 240 or length(r.change)>100
        or (r.url is not null and (length(r.url)>2048 or r.url !~ '^https://www\.momorank\.com/(douyin/)?games/[0-9]+([?].*)?$'
          or v_douyin<>(r.url like 'https://www.momorank.com/douyin/%')))) then raise exception 'Invalid highlight row'; end if;
  if v_rising_count>0 and (
    exists(select 1 from jsonb_to_recordset(p_highlights->'rising') as r(position int,"sourceId" text,title text,url text,metric text,change text,tags jsonb)
      where r.position is null or r."sourceId" is null or length(btrim(r."sourceId")) not between 1 and 240
        or r.title is null or length(btrim(r.title)) not between 1 and 240 or length(r.metric)>100 or length(r.change)>100
        or r.url is null or length(r.url)>2048 or r.url !~ '^https://www\.momorank\.com/(douyin/)?games/[0-9]+([?].*)?$'
        or v_douyin<>(r.url like 'https://www.momorank.com/douyin/%'))
    or (select min(r.position)<>1 or max(r.position)<>v_rising_count or count(distinct r.position)<>v_rising_count or count(distinct r."sourceId")<>v_rising_count
      from jsonb_to_recordset(p_highlights->'rising') as r(position int,"sourceId" text))) then raise exception 'Invalid overview rising rows'; end if;
  perform pg_advisory_xact_lock(hashtext('game_discovery_cache:'||p_dataset));
  if exists(select 1 from public.game_discovery_cache where dataset=p_dataset
    and (collected_at>=p_collected_at or source_date>p_source_date)) then return 0; end if;
  insert into public.game_discovery_cache(dataset,source_date,collected_at,source_modified_at,item_count,highlights)
    values(p_dataset,p_source_date,p_collected_at,p_source_modified_at,v_count,p_highlights)
    on conflict(dataset) do update set source_date=excluded.source_date,collected_at=excluded.collected_at,
      source_modified_at=excluded.source_modified_at,item_count=excluded.item_count,highlights=excluded.highlights;
  delete from public.game_discovery_cache_rows where dataset=p_dataset;
  insert into public.game_discovery_cache_rows(dataset,position,source_id,title,summary,url,metric,change,tags)
    select p_dataset,r.position,r."sourceId",r.title,r.summary,r.url,r.metric,r.change,coalesce(r.tags,'{}')
    from jsonb_to_recordset(p_items) as r(position int,"sourceId" text,title text,summary text,url text,metric text,change text,tags text[]);
  return v_count;
end;
$$;
revoke all on function public.replace_game_discovery_cache_v2(text,date,timestamptz,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_game_discovery_cache_v2(text,date,timestamptz,timestamptz,jsonb,jsonb) to service_role;
commit;
