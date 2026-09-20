alter table public.journal_entries
  add column if not exists user_id uuid references public.fcl_users(id) on delete cascade;

alter table public.journal_entries
  alter column participant_id drop not null;

update public.journal_entries j
set user_id = p.user_id
from public.participants p
where j.participant_id = p.id
  and j.user_id is null;

create index if not exists idx_journal_entries_user_date
  on public.journal_entries(user_id, entry_date desc);

create unique index if not exists uq_journal_entries_user_date_source
  on public.journal_entries(user_id, entry_date, source)
  where participant_id is null;

create table if not exists public.life_story_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.fcl_users(id) on delete cascade,
  page_date date not null,
  page_no integer not null default 1,
  lines jsonb not null default '[]'::jsonb,
  source_entry_ids uuid[] not null default '{}',
  generation_version text not null default 'v1-ai',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, page_date)
);

create index if not exists idx_life_story_pages_user_date
  on public.life_story_pages(user_id, page_date);

alter table public.life_story_pages enable row level security;

revoke all on table public.life_story_pages from anon, authenticated, public;
grant select, insert, update, delete on table public.life_story_pages to service_role;

drop policy if exists life_story_pages_deny_anon on public.life_story_pages;
create policy life_story_pages_deny_anon on public.life_story_pages
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);