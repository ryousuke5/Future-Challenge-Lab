/*
  FCL journal source storage
  Keeps the exact daily journal text separate from derived AI analysis.
*/

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  entry_date date not null,
  source text not null default 'chatgpt' check (source in ('chatgpt','fcl','manual')),
  raw_text text not null check (char_length(trim(raw_text)) between 1 and 20000),
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(participant_id, entry_date, source)
);

create index if not exists idx_journal_entries_participant_date
  on public.journal_entries(participant_id, entry_date desc);

alter table public.journal_entries enable row level security;

revoke all on table public.journal_entries from public, anon, authenticated;
grant select, insert, update, delete on table public.journal_entries to service_role;

drop policy if exists deny_direct_api_access on public.journal_entries;
create policy deny_direct_api_access
  on public.journal_entries
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
