begin;

-- Cached public metadata from the first content-feed sources. Browser requests
-- read only this table; external websites are contacted exclusively by the
-- CRON_SECRET-protected refresh endpoint.
create table if not exists public.content_feed_items (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  source_id     text not null check (length(source_id) between 1 and 300),
  category      text not null check (category ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  title         text not null check (length(title) between 1 and 240),
  url           text not null check (length(url) <= 2048 and url ~ '^https://'),
  cover_url     text check (cover_url is null or (length(cover_url) <= 2048 and cover_url ~ '^https://')),
  author        text check (author is null or length(author) <= 120),
  summary       text check (summary is null or length(summary) <= 280),
  published_at  timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (source, source_id),
  unique (source, url)
);

create index if not exists content_feed_items_published_idx
  on public.content_feed_items (published_at desc nulls last, first_seen_at desc);
create index if not exists content_feed_items_source_published_idx
  on public.content_feed_items (source, published_at desc nulls last, first_seen_at desc);
create index if not exists content_feed_items_category_published_idx
  on public.content_feed_items (category, published_at desc nulls last, first_seen_at desc);

alter table public.content_feed_items enable row level security;
revoke all on table public.content_feed_items from public, anon, authenticated;
grant all on table public.content_feed_items to service_role;

commit;
