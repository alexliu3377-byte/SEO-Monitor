-- Keep Aizhan weight extremes current without treating a transient zero or a
-- failed/partial page as a real historical low. The crawler calls the RPC only
-- after it has verified that the expected Aizhan fields exist in the page.
begin;

alter table public.site_aizhan_history_summaries
  add column if not exists pc_zero_streak integer not null default 0,
  add column if not exists pc_last_zero_date date,
  add column if not exists mobile_zero_streak integer not null default 0,
  add column if not exists mobile_last_zero_date date,
  add column if not exists index_zero_streak integer not null default 0,
  add column if not exists index_last_zero_date date;

create or replace function public.record_aizhan_daily_observation(
  p_site_id uuid,
  p_record_date date,
  p_weight_valid boolean,
  p_pc_weight integer,
  p_mobile_weight integer,
  p_index_valid boolean,
  p_index_count integer
)
returns table(weight_should_store boolean, index_should_store boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.site_aizhan_history_summaries%rowtype;
  v_pc_streak integer;
  v_mobile_streak integer;
  v_index_streak integer;
  v_pc_confirmed boolean;
  v_mobile_confirmed boolean;
  v_index_confirmed boolean;
begin
  insert into public.site_aizhan_history_summaries (site_id)
  values (p_site_id)
  on conflict (site_id) do nothing;

  select * into v_row
  from public.site_aizhan_history_summaries
  where site_id = p_site_id
  for update;

  v_pc_streak := case
    when not p_weight_valid or p_pc_weight <> 0 then 0
    when v_row.pc_last_zero_date = p_record_date - 1 then v_row.pc_zero_streak + 1
    else 1
  end;
  v_mobile_streak := case
    when not p_weight_valid or p_mobile_weight <> 0 then 0
    when v_row.mobile_last_zero_date = p_record_date - 1 then v_row.mobile_zero_streak + 1
    else 1
  end;
  v_index_streak := case
    when not p_index_valid or p_index_count <> 0 then 0
    when v_row.index_last_zero_date = p_record_date - 1 then v_row.index_zero_streak + 1
    else 1
  end;

  v_pc_confirmed := p_weight_valid and (p_pc_weight > 0 or v_pc_streak >= 2);
  v_mobile_confirmed := p_weight_valid and (p_mobile_weight > 0 or v_mobile_streak >= 2);
  v_index_confirmed := p_index_valid and (p_index_count > 0 or v_index_streak >= 2);

  update public.site_aizhan_history_summaries
  set
    pc_zero_streak = v_pc_streak,
    pc_last_zero_date = case when p_weight_valid and p_pc_weight = 0 then p_record_date else null end,
    mobile_zero_streak = v_mobile_streak,
    mobile_last_zero_date = case when p_weight_valid and p_mobile_weight = 0 then p_record_date else null end,
    index_zero_streak = v_index_streak,
    index_last_zero_date = case when p_index_valid and p_index_count = 0 then p_record_date else null end,
    pc_current_weight = case when v_pc_confirmed then p_pc_weight else pc_current_weight end,
    mobile_current_weight = case when v_mobile_confirmed then p_mobile_weight else mobile_current_weight end,
    pc_max_weight = case when v_pc_confirmed and (pc_max_date is null or p_pc_weight > pc_max_weight) then p_pc_weight else pc_max_weight end,
    pc_max_keywords = case when v_pc_confirmed and (pc_max_date is null or p_pc_weight > pc_max_weight) then 0 else pc_max_keywords end,
    pc_max_date = case when v_pc_confirmed and (pc_max_date is null or p_pc_weight > pc_max_weight) then p_record_date else pc_max_date end,
    pc_min_weight = case when v_pc_confirmed and (pc_min_date is null or p_pc_weight < pc_min_weight) then p_pc_weight else pc_min_weight end,
    pc_min_keywords = case when v_pc_confirmed and (pc_min_date is null or p_pc_weight < pc_min_weight) then 0 else pc_min_keywords end,
    pc_min_date = case when v_pc_confirmed and (pc_min_date is null or p_pc_weight < pc_min_weight) then p_record_date else pc_min_date end,
    mobile_max_weight = case when v_mobile_confirmed and (mobile_max_date is null or p_mobile_weight > mobile_max_weight) then p_mobile_weight else mobile_max_weight end,
    mobile_max_keywords = case when v_mobile_confirmed and (mobile_max_date is null or p_mobile_weight > mobile_max_weight) then 0 else mobile_max_keywords end,
    mobile_max_date = case when v_mobile_confirmed and (mobile_max_date is null or p_mobile_weight > mobile_max_weight) then p_record_date else mobile_max_date end,
    mobile_min_weight = case when v_mobile_confirmed and (mobile_min_date is null or p_mobile_weight < mobile_min_weight) then p_mobile_weight else mobile_min_weight end,
    mobile_min_keywords = case when v_mobile_confirmed and (mobile_min_date is null or p_mobile_weight < mobile_min_weight) then 0 else mobile_min_keywords end,
    mobile_min_date = case when v_mobile_confirmed and (mobile_min_date is null or p_mobile_weight < mobile_min_weight) then p_record_date else mobile_min_date end,
    source_checked_at = case when p_weight_valid or p_index_valid then now() else source_checked_at end,
    updated_at = now()
  where site_id = p_site_id;

  weight_should_store := v_pc_confirmed and v_mobile_confirmed;
  index_should_store := v_index_confirmed;
  return next;
end;
$$;

revoke all on function public.record_aizhan_daily_observation(uuid, date, boolean, integer, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.record_aizhan_daily_observation(uuid, date, boolean, integer, integer, boolean, integer) to service_role;

commit;
