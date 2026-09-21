-- Share login throttling across every Vercel instance without retaining raw
-- IP addresses or usernames. The application sends only HMAC-SHA256 digests.
begin;

create table if not exists public.login_rate_limits (
  scope text not null check (scope in ('ip', 'ip_username')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

create index if not exists login_rate_limits_updated_at_idx
  on public.login_rate_limits (updated_at);

create or replace function public.consume_login_rate_limit(
  p_ip_hash text,
  p_username_hash text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_scope text;
  v_key_hash text;
  v_max_attempts integer;
  v_attempt_count integer;
  v_window_started_at timestamptz;
  v_blocked_until timestamptz;
  v_allowed boolean := true;
  v_retry_after integer := 0;
begin
  if p_ip_hash is null
    or p_username_hash is null
    or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_username_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid login rate-limit digest';
  end if;

  delete from public.login_rate_limits
  where updated_at < v_now - interval '7 days';

  for v_scope, v_key_hash, v_max_attempts in
    select * from (values
      ('ip'::text, p_ip_hash, 50),
      ('ip_username'::text, p_username_hash, 10)
    ) limits(scope, key_hash, max_attempts)
  loop
    insert into public.login_rate_limits (
      scope, key_hash, attempt_count, window_started_at, updated_at
    ) values (
      v_scope, v_key_hash, 0, v_now, v_now
    ) on conflict (scope, key_hash) do nothing;

    select attempt_count, window_started_at, blocked_until
    into v_attempt_count, v_window_started_at, v_blocked_until
    from public.login_rate_limits
    where scope = v_scope and key_hash = v_key_hash
    for update;

    if v_blocked_until is not null and v_blocked_until > v_now then
      v_allowed := false;
      v_retry_after := greatest(
        v_retry_after,
        ceil(extract(epoch from (v_blocked_until - v_now)))::integer
      );
    elsif v_window_started_at <= v_now - interval '10 minutes' then
      update public.login_rate_limits
      set attempt_count = 1,
          window_started_at = v_now,
          blocked_until = null,
          updated_at = v_now
      where scope = v_scope and key_hash = v_key_hash;
    elsif v_attempt_count >= v_max_attempts then
      v_blocked_until := v_now + interval '15 minutes';
      update public.login_rate_limits
      set blocked_until = v_blocked_until,
          updated_at = v_now
      where scope = v_scope and key_hash = v_key_hash;
      v_allowed := false;
      v_retry_after := greatest(v_retry_after, 900);
    else
      update public.login_rate_limits
      set attempt_count = attempt_count + 1,
          blocked_until = null,
          updated_at = v_now
      where scope = v_scope and key_hash = v_key_hash;
    end if;
  end loop;

  return query select v_allowed, v_retry_after;
end
$$;

create or replace function public.clear_successful_login_rate_limit(
  p_username_hash text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_username_hash is null or p_username_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid login rate-limit digest';
  end if;
  delete from public.login_rate_limits
  where scope = 'ip_username' and key_hash = p_username_hash;
end
$$;

alter table public.login_rate_limits enable row level security;
revoke all on table public.login_rate_limits from public, anon, authenticated;
grant all on table public.login_rate_limits to service_role;

revoke all on function public.consume_login_rate_limit(text, text) from public, anon, authenticated;
revoke all on function public.clear_successful_login_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_login_rate_limit(text, text) to service_role;
grant execute on function public.clear_successful_login_rate_limit(text) to service_role;

update public.development_releases
set
  highlights = case
    when highlights @> '["登录限流改为 Supabase 全局计数，避免 Vercel 多实例分别计数"]'::jsonb then highlights
    else highlights || '["登录限流改为 Supabase 全局计数，避免 Vercel 多实例分别计数"]'::jsonb
  end,
  implementation_notes = case
    when implementation_notes @> '["登录失败按 IP 与 IP＋用户名双层限流；数据库仅保存 HMAC 摘要，不保存明文 IP 或用户名。"]'::jsonb then implementation_notes
    else implementation_notes || '["登录失败按 IP 与 IP＋用户名双层限流；数据库仅保存 HMAC 摘要，不保存明文 IP 或用户名。"]'::jsonb
  end,
  limitations = coalesce((
    select jsonb_agg(item)
    from jsonb_array_elements(limitations) as limitation(item)
    where item #>> '{}' not like '登录限流目前同时依赖 Cloudflare Turnstile%'
  ), '[]'::jsonb),
  updated_at = now()
where version = 'v2.4.1'
  and created_by is null;

commit;
