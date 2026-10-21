begin;
set local lock_timeout='5s';
alter table public.content_feed_items add column if not exists source_category text
  check(source_category is null or length(source_category) between 1 and 40);
-- Old workers/RSS imports must not erase a category already read from the forum.
create or replace function public.preserve_content_source_category()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.source_category:=coalesce(nullif(btrim(new.source_category),''),old.source_category);
  return new;
end;
$$;
drop trigger if exists preserve_content_source_category on public.content_feed_items;
create trigger preserve_content_source_category before update on public.content_feed_items
  for each row execute function public.preserve_content_source_category();
commit;
