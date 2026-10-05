-- 超管删除词后加入排除名单，阻止后续抓取重新写入词库。
create table if not exists public.keyword_volume_exclusions (
  keyword text primary key,
  reason text not null default '超管从词库删除',
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.keyword_volume_exclusions enable row level security;

create or replace function public.prevent_excluded_keyword_volume()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.keyword_volume_exclusions exclusion
    where exclusion.keyword = new.keyword
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_excluded_keyword_volume_insert on public.keyword_volume;
create trigger prevent_excluded_keyword_volume_insert
before insert on public.keyword_volume
for each row execute function public.prevent_excluded_keyword_volume();

create or replace function public.exclude_keyword_volume(p_keyword text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_keyword), '') is null then
    raise exception 'keyword is required';
  end if;

  insert into public.keyword_volume_exclusions (keyword, created_by)
  values (trim(p_keyword), p_user_id)
  on conflict (keyword) do update set
    created_by = excluded.created_by,
    created_at = now();

  delete from public.keyword_volume where keyword = trim(p_keyword);
  return true;
end;
$$;

revoke all on function public.exclude_keyword_volume(text, uuid) from public, anon, authenticated;
grant execute on function public.exclude_keyword_volume(text, uuid) to service_role;
