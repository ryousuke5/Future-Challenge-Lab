create extension if not exists pgcrypto;

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  external_user_id text unique,
  name text,
  email text,
  challenge text,
  goal text,
  created_at timestamptz not null default now()
);

create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  autonomy_total int not null default 0,
  autonomy_answers jsonb not null default '{}'::jsonb,
  risk_score numeric,
  risk_level text,
  analysis jsonb,
  checked_in_at timestamptz not null default now()
);

create table if not exists interventions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  checkin_id uuid references checkins(id) on delete set null,
  intervention_type text not null,
  risk_level text not null,
  intervention_content text not null,
  reason text,
  conducted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists intervention_assignments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  checkin_id uuid references checkins(id) on delete set null,
  variant text not null check (variant in ('A','B')),
  intervention_type text not null,
  intervention_text text not null,
  meta jsonb not null default '{}'::jsonb,
  assigned_at timestamptz not null default now(),
  unique(participant_id, checkin_id)
);

create table if not exists action_results (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  intervention_id uuid references intervention_assignments(id) on delete set null,
  action_text text,
  completed boolean not null default false,
  barrier text,
  result_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists supporters (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  supporter_name text not null,
  email text,
  support_category text not null,
  strengths text[] not null default '{}',
  timing_tags text[] not null default '{}',
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists supporter_matches (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  supporter_id uuid not null references supporters(id) on delete cascade,
  score numeric not null,
  reason text,
  status text not null default 'suggested' check (status in ('suggested','requested','connected','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists connection_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  supporter_id uuid not null references supporters(id) on delete cascade,
  match_id uuid references supporter_matches(id) on delete set null,
  event_type text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists intervention_outcomes (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  intervention_id uuid not null references intervention_assignments(id) on delete cascade,
  pre_risk numeric,
  post_risk numeric,
  action_completed boolean,
  resumed boolean,
  outcome_score numeric,
  observed_at timestamptz not null default now()
);

create table if not exists intervention_policy_decisions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  checkin_id uuid references checkins(id) on delete cascade,
  context jsonb not null default '{}'::jsonb,
  candidate_scores jsonb not null default '[]'::jsonb,
  selected_action_type text not null default 'intervention' check (selected_action_type in ('intervention','supporter','both')),
  selected_variant text check (selected_variant in ('A','B')),
  selected_supporter_id uuid references supporters(id) on delete set null,
  exploration boolean not null default false,
  policy_version text not null,
  decided_at timestamptz not null default now()
);

create table if not exists supporter_outcomes (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id) on delete cascade,
  supporter_id uuid references supporters(id) on delete cascade,
  match_id uuid references supporter_matches(id) on delete set null,
  outcome text,
  outcome_score numeric,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists model_learning_events (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id) on delete set null,
  intervention_id uuid references intervention_assignments(id) on delete set null,
  features jsonb not null default '{}'::jsonb,
  label jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_checkins_participant on checkins(participant_id, checked_in_at desc);
create index if not exists idx_actions_participant on action_results(participant_id, created_at desc);
create index if not exists idx_matches_participant on supporter_matches(participant_id, score desc);

alter table participants enable row level security;
alter table checkins enable row level security;
alter table interventions enable row level security;
alter table intervention_assignments enable row level security;
alter table action_results enable row level security;
alter table supporters enable row level security;
alter table supporter_matches enable row level security;
alter table connection_events enable row level security;
alter table intervention_outcomes enable row level security;
alter table model_learning_events enable row level security;
alter table intervention_policy_decisions enable row level security;
alter table supporter_outcomes enable row level security;
