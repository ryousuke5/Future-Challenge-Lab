-- Future Challenge Lab unified intervention + supporter learning policy v2
-- Run after schema.sql on an existing Supabase project.

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

alter table intervention_policy_decisions drop constraint if exists intervention_policy_decisions_selected_variant_check;
alter table intervention_policy_decisions alter column selected_variant drop not null;
alter table intervention_policy_decisions add column if not exists selected_action_type text;
alter table intervention_policy_decisions add column if not exists selected_supporter_id uuid references supporters(id) on delete set null;
update intervention_policy_decisions set selected_action_type='intervention' where selected_action_type is null;
alter table intervention_policy_decisions alter column selected_action_type set default 'intervention';
alter table intervention_policy_decisions alter column selected_action_type set not null;
alter table intervention_policy_decisions add constraint intervention_policy_decisions_action_type_check check (selected_action_type in ('intervention','supporter','both'));
alter table intervention_policy_decisions add constraint intervention_policy_decisions_selected_variant_check check (selected_variant is null or selected_variant in ('A','B'));

create index if not exists idx_interventions_participant on interventions(participant_id, conducted_at desc);
create index if not exists idx_policy_decisions_participant on intervention_policy_decisions(participant_id, decided_at desc);
create index if not exists idx_supporter_outcomes_supporter on supporter_outcomes(supporter_id, created_at desc);
