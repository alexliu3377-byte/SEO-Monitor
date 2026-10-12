-- 分组成员不再区分“应用／游戏”。字段暂时保留，避免破坏旧接口与历史部署，
-- 但统一为 both，后续新增成员也默认不区分内容类型。
update public.task_group_members
set member_type = 'both'
where member_type is distinct from 'both';

alter table public.task_group_members
  alter column member_type set default 'both';
