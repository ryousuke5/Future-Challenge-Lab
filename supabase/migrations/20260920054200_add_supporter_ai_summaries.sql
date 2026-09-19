create table if not exists public.supporter_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  supporter_id uuid not null references public.supporters(id) on delete cascade,
  match_id uuid null references public.supporter_matches(id) on delete set null,
  summary text not null default '',
  current_state text,
  continuation_risk text,
  risk_reasons jsonb not null default '[]'::jsonb,
  support_points jsonb not null default '[]'::jsonb,
  recommended_first_move text,
  caution text,
  source_fingerprint text not null,
  model_version text not null default 'v3-ai',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, supporter_id, match_id)
);

alter table public.supporter_ai_summaries enable row level security;
revoke all on table public.supporter_ai_summaries from anon, authenticated;
grant select, insert, update, delete on table public.supporter_ai_summaries to service_role;

drop policy if exists supporter_ai_summaries_service_role on public.supporter_ai_summaries;
create policy supporter_ai_summaries_service_role on public.supporter_ai_summaries
  for all to service_role using (true) with check (true);

create index if not exists idx_supporter_ai_summaries_match
  on public.supporter_ai_summaries (match_id, updated_at desc);

create index if not exists idx_supporter_ai_summaries_participant
  on public.supporter_ai_summaries (participant_id, updated_at desc);
