-- Add a private discussion thread for super-admin priority feedback.
begin;

alter table public.development_requests
  drop constraint if exists development_requests_status_check;
alter table public.development_requests
  add constraint development_requests_status_check
  check (status in (
    'pending', 'accepted', 'researching', 'trial', 'in_progress',
    'completed', 'blocked', 'declined'
  ));

create table if not exists public.development_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.development_requests(id) on delete cascade,
  author_id uuid references public.user_profiles(id) on delete set null,
  author_name text not null,
  author_role text not null check (author_role = 'super'),
  message_type text not null default 'discussion'
    check (message_type in ('discussion', 'research', 'experiment', 'decision')),
  content text not null check (char_length(btrim(content)) between 2 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists development_request_messages_request_date_idx
  on public.development_request_messages (request_id, created_at desc, id desc);

alter table public.development_request_messages enable row level security;
revoke all on table public.development_request_messages from public, anon, authenticated;
grant all on table public.development_request_messages to service_role;

insert into public.development_releases (
  version, title, release_date, status, summary, highlights,
  implementation_notes, limitations, deployment_range, source_note
) values (
  'v2.3.5',
  '超管重点沟通与试行记录',
  '2026-09-04',
  'completed',
  '为超管提出的重点功能增加独立讨论串，可以持续共享调研资料、试行结果和最终决策。',
  '["超管重点反馈独立沟通记录", "调研资料、普通讨论、试行结果和决策结论分类", "新增调研中与试行中状态", "讨论内容只对超管开放"]'::jsonb,
  '["消息与原始反馈记录关联并独立分页，只有展开沟通时才读取。", "所有超管可以追加讨论；项目负责人继续负责修改总体处理状态。"]'::jsonb,
  '["调研资料属于方案参考，正式接入外部平台前仍需确认接口、账号、授权、频率和合规限制。"]'::jsonb,
  '2026-09-04',
  '依据超管重点功能沟通需求新增'
)
on conflict (version) do nothing;

commit;
