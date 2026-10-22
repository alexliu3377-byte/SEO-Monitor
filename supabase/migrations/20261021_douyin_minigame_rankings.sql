begin;

create table if not exists public.douyin_minigame_collections (
  snapshot_date date primary key,
  collected_at timestamptz not null,
  item_count integer not null check (item_count between 3 and 300)
);
create table if not exists public.douyin_minigame_rankings (
  snapshot_date date not null references public.douyin_minigame_collections(snapshot_date) on delete cascade,
  board text not null check (board in ('new','hot','grossing')),
  rank integer not null check (rank between 1 and 100),
  game_id text not null check (game_id ~ '^tt([a-f0-9]{16}|[a-f0-9]{18})$'),
  title text not null check (length(btrim(title)) between 1 and 240),
  summary text check (summary is null or length(summary) <= 500),
  primary key(snapshot_date, board, rank),
  unique(snapshot_date, board, game_id)
);
create index if not exists douyin_minigame_collections_latest_idx on public.douyin_minigame_collections(collected_at desc);
alter table public.douyin_minigame_collections enable row level security;
alter table public.douyin_minigame_rankings enable row level security;
revoke all on public.douyin_minigame_collections, public.douyin_minigame_rankings from public, anon, authenticated;
grant all on public.douyin_minigame_collections, public.douyin_minigame_rankings to service_role;

-- Publish all three boards atomically. Failed or incomplete collection must never
-- replace a successful snapshot; yesterday remains readable after source errors.
create or replace function public.replace_douyin_minigame_rankings(p_collected_at timestamptz, p_items jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_day date := (p_collected_at at time zone 'Asia/Kuala_Lumpur')::date;
  v_count integer;
begin
  if p_collected_at is null or p_collected_at > now() + interval '5 minutes'
    or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid mini-game snapshot'; end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 3 or v_count > 300 then raise exception 'Invalid mini-game row count'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as r(board text, rank integer, "gameId" text, title text)
    where r.board is null or r.board not in ('new','hot','grossing') or r.rank is null
      or r."gameId" is null or r.title is null
  ) then raise exception 'Invalid mini-game fields'; end if;
  if (select count(distinct r.board) from jsonb_to_recordset(p_items) as r(board text)) <> 3
    or exists (select 1 from jsonb_to_recordset(p_items) as r(board text, rank integer, "gameId" text)
      group by r.board having min(r.rank) <> 1 or max(r.rank) <> count(*)
        or count(distinct r.rank) <> count(*) or count(distinct r."gameId") <> count(*))
    then raise exception 'Incomplete mini-game boards'; end if;
  perform pg_advisory_xact_lock(hashtext('douyin_minigame_rankings'));
  if exists(select 1 from public.douyin_minigame_collections where snapshot_date = v_day and collected_at >= p_collected_at)
    then return 0; end if;
  insert into public.douyin_minigame_collections values(v_day,p_collected_at,v_count)
    on conflict(snapshot_date) do update set collected_at=excluded.collected_at,item_count=excluded.item_count;
  delete from public.douyin_minigame_rankings where snapshot_date=v_day;
  insert into public.douyin_minigame_rankings(snapshot_date,board,rank,game_id,title,summary)
    select v_day,r.board,r.rank,r."gameId",r.title,r.summary
    from jsonb_to_recordset(p_items) as r(board text,rank integer,"gameId" text,title text,summary text);
  return v_count;
end;
$$;
revoke all on function public.replace_douyin_minigame_rankings(timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.replace_douyin_minigame_rankings(timestamptz,jsonb) to service_role;

create or replace function public.get_douyin_minigame_page(p_board text,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_board is null or p_board not in ('new','hot','grossing') or p_page is null or p_page<1 or p_page>5 then raise exception 'Invalid board/page'; end if;
  return (with latest as (select snapshot_date,collected_at from public.douyin_minigame_collections order by collected_at desc limit 1),
    board_rows as (select r.rank,r.game_id,r.title,r.summary from public.douyin_minigame_rankings r join latest l using(snapshot_date) where r.board=p_board),
    page_rows as (select * from board_rows order by rank limit 20 offset (p_page-1)*20)
    select jsonb_build_object('collectedAt',(select collected_at from latest),'total',(select count(*) from board_rows),
      'items',coalesce((select jsonb_agg(to_jsonb(r) order by rank) from page_rows r),'[]'::jsonb),'page',p_page));
end;
$$;
revoke all on function public.get_douyin_minigame_page(text,integer) from public,anon,authenticated;
grant execute on function public.get_douyin_minigame_page(text,integer) to service_role;
commit;
