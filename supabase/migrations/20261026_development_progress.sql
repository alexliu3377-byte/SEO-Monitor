-- Independent from feedback. Browser roles have no direct access.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table public.development_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  description text not null check (length(trim(description)) between 1 and 4000),
  owner_name text not null default '' check (length(owner_name)<=80),
  stage text not null default 'pending' check (stage in ('pending','planned','development','testing','ready','live','paused','cancelled')),
  checklist jsonb not null default '[]' check (jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=30),
  blocker text not null default '' check (length(blocker)<=2000),
  next_step text not null default '' check (length(next_step)<=2000),
  test_notes text not null default '' check (length(test_notes)<=4000),
  deployment_notes text not null default '' check (length(deployment_notes)<=4000),
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  started_at timestamptz, tested_at timestamptz, deployed_at timestamptz,
  release_id uuid references public.development_releases(id) on delete restrict,
  check (release_id is null or stage='live')
);
create table public.development_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.development_tasks(id) on delete restrict,
  actor_id uuid not null references public.user_profiles(id),
  actor_name text not null,
  note text not null check (length(trim(note)) between 1 and 2000),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index development_tasks_queue_idx on public.development_tasks(updated_at desc,id) where release_id is null and stage<>'cancelled';
create index development_tasks_release_idx on public.development_tasks(release_id,updated_at desc);
create index development_task_events_task_idx on public.development_task_events(task_id,id desc);
alter table public.development_tasks enable row level security;
alter table public.development_task_events enable row level security;
revoke all on public.development_tasks,public.development_task_events from public,anon,authenticated;
grant select,insert,update on public.development_tasks to service_role;
-- Events are append-only, even for the application service role.
revoke all on public.development_task_events from service_role;
grant select,insert on public.development_task_events to service_role;
grant usage,select on sequence public.development_task_events_id_seq to service_role;

create function public.save_development_task(p_id uuid,p_revision integer,p_actor uuid,p_data jsonb,p_note text,p_release uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  t public.development_tasks; actor_name text; item jsonb; stage_value text;
begin
  select coalesce(nullif(username,''),'项目负责人') into actor_name from public.user_profiles
    where id=p_actor and role='super' and is_active is not false;
  if actor_name is null then raise insufficient_privilege; end if;
  if p_note is null or length(trim(p_note)) not between 1 and 2000 then raise invalid_parameter_value; end if;
  if p_id is not null then
    select * into t from public.development_tasks where id=p_id for update;
    if not found then raise no_data_found; end if;
    if t.revision<>p_revision then raise serialization_failure; end if;
    if t.release_id is not null then raise invalid_parameter_value; end if;
  end if;
  if p_release is not null then
    if p_id is null or t.stage<>'live' or not exists(select 1 from public.development_releases where id=p_release and status='completed') then
      raise invalid_parameter_value;
    end if;
    update public.development_tasks set release_id=p_release,revision=revision+1,updated_at=now() where id=p_id returning * into t;
  else
    if jsonb_typeof(p_data)<>'object' or p_data is null then raise invalid_parameter_value; end if;
    stage_value := p_data->>'stage';
    if stage_value is null or stage_value not in ('pending','planned','development','testing','ready','live','paused','cancelled') then raise invalid_parameter_value; end if;
    if jsonb_typeof(p_data->'checklist') is distinct from 'array' or jsonb_array_length(p_data->'checklist')>30 then raise invalid_parameter_value; end if;
    for item in select value from jsonb_array_elements(p_data->'checklist') loop
      if jsonb_typeof(item->'text') is distinct from 'string' or length(trim(item->>'text')) not between 1 and 300
        or jsonb_typeof(item->'done') is distinct from 'boolean' or coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise invalid_parameter_value; end if;
    end loop;
    if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_data->'checklist')) then raise invalid_parameter_value; end if;
    if stage_value in ('ready','live') and (jsonb_array_length(p_data->'checklist')=0
      or exists(select 1 from jsonb_array_elements(p_data->'checklist') where value->>'done'<>'true')
      or coalesce(trim(p_data->>'test_notes'),'')='') then raise invalid_parameter_value; end if;
    if stage_value='live' and coalesce(trim(p_data->>'deployment_notes'),'')='' then raise invalid_parameter_value; end if;
    if stage_value in ('paused','cancelled') and coalesce(trim(p_data->>'blocker'),'')='' then raise invalid_parameter_value; end if;
    if p_id is null then
      insert into public.development_tasks(title,description,owner_name,stage,checklist,blocker,next_step,test_notes,deployment_notes,
        started_at,tested_at,deployed_at)
      values(p_data->>'title',p_data->>'description',p_data->>'owner_name',stage_value,p_data->'checklist',p_data->>'blocker',p_data->>'next_step',p_data->>'test_notes',p_data->>'deployment_notes',
        case when stage_value in ('development','testing','ready','live') then now() end,
        case when stage_value in ('ready','live') then now() end,case when stage_value='live' then now() end) returning * into t;
    else
      update public.development_tasks set title=p_data->>'title',description=p_data->>'description',owner_name=p_data->>'owner_name',
        stage=stage_value,checklist=p_data->'checklist',blocker=p_data->>'blocker',next_step=p_data->>'next_step',
        test_notes=p_data->>'test_notes',deployment_notes=p_data->>'deployment_notes',revision=revision+1,updated_at=now(),
        started_at=coalesce(started_at,case when stage_value in ('development','testing','ready','live') then now() end),
        tested_at=case when stage_value in ('ready','live') then coalesce(tested_at,now()) else null end,
        deployed_at=case when stage_value='live' then coalesce(deployed_at,now()) else null end
      where id=p_id returning * into t;
    end if;
  end if;
  insert into public.development_task_events(task_id,actor_id,actor_name,note,snapshot)
    values(t.id,p_actor,actor_name,trim(p_note),to_jsonb(t));
  return to_jsonb(t);
end $$;
revoke all on function public.save_development_task(uuid,integer,uuid,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.save_development_task(uuid,integer,uuid,jsonb,text,uuid) to service_role;

create function public.development_task_counts() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_object_agg(stage,n),'{}') from (
    select stage,count(*) as n from public.development_tasks where release_id is null and stage<>'cancelled' group by stage
  ) counts
$$;
revoke all on function public.development_task_counts() from public,anon,authenticated;
grant execute on function public.development_task_counts() to service_role;
commit;
