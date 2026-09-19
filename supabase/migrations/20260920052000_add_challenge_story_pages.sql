create table if not exists public.challenge_story_pages (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  page_date date not null,
  page_no integer not null,
  lines jsonb not null default '[]'::jsonb,
  source_checkin_id uuid null references public.checkins(id) on delete set null,
  generation_version text not null default 'v1-ai',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, page_date)
);

alter table public.challenge_story_pages enable row level security;

revoke all on table public.challenge_story_pages from anon, authenticated;
grant select, insert, update, delete on table public.challenge_story_pages to service_role;

create index if not exists idx_challenge_story_pages_participant_date
  on public.challenge_story_pages (participant_id, page_date);