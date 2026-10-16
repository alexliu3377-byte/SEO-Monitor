-- Discovery date is an observed volume increase, never a fresh crawl date.
-- Do not backfill from stat_date: overwritten observations cannot prove when
-- older cumulative gains were actually discovered.
begin;

alter table public.keyword_volume
  add column if not exists last_volume_increase_date date;

comment on column public.keyword_volume.last_volume_increase_date is
  'Most recent date (Asia/Kuala_Lumpur) an increase over the stored volume was observed. Null means not recorded; unchanged/declining/repeated crawls do not advance it.';

create or replace function public.track_keyword_volume_increase_date()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- First observation has no earlier observation to compare against.
    new.last_volume_increase_date := null;
  else
    -- This is database-owned metadata. Classification/trend-only updates,
    -- repeated upserts and client-supplied dates must not manufacture a rise.
    new.last_volume_increase_date := old.last_volume_increase_date;
    if new.volume > old.volume
      and new.stat_date is not null
      and (old.stat_date is null or new.stat_date >= old.stat_date) then
      new.last_volume_increase_date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.track_keyword_volume_increase_date() from public, anon, authenticated;
drop trigger if exists keyword_volume_increase_date on public.keyword_volume;
create trigger keyword_volume_increase_date
  before insert or update on public.keyword_volume
  for each row execute function public.track_keyword_volume_increase_date();

commit;
