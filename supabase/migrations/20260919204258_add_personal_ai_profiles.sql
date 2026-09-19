create table if not exists public.personal_ai_profiles (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  profile_text text not null default '',
  observed_strengths jsonb not null default '[]'::jsonb,
  recurring_barriers jsonb not null default '[]'::jsonb,
  preferred_action_modes jsonb not null default '[]'::jsonb,
  support_preferences jsonb not null default '[]'::jsonb,
  continuity_pattern jsonb not null default '{}'::jsonb,
  current_goal text,
  source_fingerprint text not null,
  model_version text not null default 'v1',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id)
);

alter table public.personal_ai_profiles enable row level security;
revoke all on table public.personal_ai_profiles from anon, authenticated;
grant select, insert, update, delete on table public.personal_ai_profiles to service_role;

drop policy if exists personal_ai_profiles_service_role on public.personal_ai_profiles;
create policy personal_ai_profiles_service_role on public.personal_ai_profiles
  for all to service_role using (true) with check (true);

create index if not exists idx_personal_ai_profiles_participant
  on public.personal_ai_profiles (participant_id);