-- Add server-side feedback sorting, message counts and per-user unread state.
-- The board stays paginated: unread conversations come first, followed by the
-- newest feedback records.
begin;

alter table public.development_requests
  add column if not exists message_count integer not null default 0,
  add column if not exists latest_message_at timestamptz,
  add column if not exists latest_message_author_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'development_requests_message_count_check'
      and conrelid = 'public.development_requests'::regclass
  ) then
    alter table public.development_requests
      add constraint development_requests_message_count_check
      check (message_count >= 0);
  end if;
end
$$;

create table if not exists public.development_request_message_reads (
  request_id uuid not null references public.development_requests(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (request_id, user_id)
);

create index if not exists development_request_message_reads_user_idx
  on public.development_request_message_reads (user_id, last_read_at desc);
create index if not exists development_requests_board_filter_idx
  on public.development_requests (submitter_role, status, feedback_type, created_at desc);

with message_stats as (
  select
    request_id,
    count(*)::integer as message_count,
    max(created_at) as latest_message_at,
    (array_agg(author_id order by created_at desc, id desc))[1] as latest_message_author_id
  from public.development_request_messages
  group by request_id
)
update public.development_requests request
set
  message_count = stats.message_count,
  latest_message_at = stats.latest_message_at,
  latest_message_author_id = stats.latest_message_author_id
from message_stats stats
where request.id = stats.request_id;

update public.development_requests request
set
  message_count = 0,
  latest_message_at = null,
  latest_message_author_id = null
where not exists (
  select 1
  from public.development_request_messages message
  where message.request_id = request.id
);

create or replace function public.sync_development_request_message_stats()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request_id uuid;
begin
  if tg_op = 'INSERT' then
    update public.development_requests
    set
      message_count = message_count + 1,
      latest_message_at = case
        when latest_message_at is null or new.created_at >= latest_message_at then new.created_at
        else latest_message_at
      end,
      latest_message_author_id = case
        when latest_message_at is null or new.created_at >= latest_message_at then new.author_id
        else latest_message_author_id
      end
    where id = new.request_id;
    return new;
  end if;

  v_request_id := old.request_id;
  update public.development_requests request
  set
    message_count = stats.message_count,
    latest_message_at = stats.latest_message_at,
    latest_message_author_id = stats.latest_message_author_id
  from (
    select
      count(*)::integer as message_count,
      max(created_at) as latest_message_at,
      (array_agg(author_id order by created_at desc, id desc))[1] as latest_message_author_id
    from public.development_request_messages
    where request_id = v_request_id
  ) stats
  where request.id = v_request_id;
  return old;
end
$$;

drop trigger if exists sync_development_request_message_stats on public.development_request_messages;
create trigger sync_development_request_message_stats
after insert or delete on public.development_request_messages
for each row execute function public.sync_development_request_message_stats();

create or replace function public.get_feedback_requests_page(
  p_scope text,
  p_viewer_id uuid,
  p_status text default '',
  p_feedback_type text default '',
  p_offset integer default 0,
  p_limit integer default 10
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with scoped as (
    select
      request.*,
      (
        request.latest_message_at is not null
        and request.latest_message_author_id is distinct from p_viewer_id
        and (
          read_state.last_read_at is null
          or read_state.last_read_at < request.latest_message_at
        )
      ) as has_unread
    from public.development_requests request
    left join public.development_request_message_reads read_state
      on read_state.request_id = request.id
     and read_state.user_id = p_viewer_id
    where (
        (p_scope = 'mine' and request.created_by = p_viewer_id)
        or (p_scope = 'super' and request.submitter_role = 'super')
        or (p_scope = 'board' and request.submitter_role in ('normal', 'admin'))
      )
      and (coalesce(p_status, '') = '' or request.status = p_status)
      and (coalesce(p_feedback_type, '') = '' or request.feedback_type = p_feedback_type)
  ), ordered as (
    select scoped.*,
      row_number() over (
        order by
          has_unread desc,
          case when has_unread then latest_message_at end desc nulls last,
          created_at desc,
          id desc
      ) as ordinal
    from scoped
  ), page_rows as (
    select *
    from ordered
    where ordinal > greatest(coalesce(p_offset, 0), 0)
      and ordinal <= greatest(coalesce(p_offset, 0), 0)
        + least(greatest(coalesce(p_limit, 10), 1), 50)
  )
  select pg_catalog.jsonb_build_object(
    'requests', coalesce(
      (select pg_catalog.jsonb_agg(to_jsonb(page_rows) - 'ordinal' order by ordinal) from page_rows),
      '[]'::jsonb
    ),
    'total', (select count(*)::integer from scoped)
  )
$$;

alter table public.development_request_message_reads enable row level security;
revoke all on table public.development_request_message_reads from public, anon, authenticated;
grant all on table public.development_request_message_reads to service_role;

revoke all on function public.sync_development_request_message_stats() from public;
revoke all on function public.get_feedback_requests_page(text, uuid, text, text, integer, integer) from public;
grant execute on function public.get_feedback_requests_page(text, uuid, text, text, integer, integer) to service_role;

commit;
