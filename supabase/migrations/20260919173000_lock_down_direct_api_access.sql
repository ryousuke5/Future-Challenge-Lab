/*
  FCL security hardening
  - Public tables remain RLS-protected.
  - Browser/API roles (anon, authenticated) do not access FCL tables directly.
  - FCL server routes use the Supabase service_role key.
  - A restrictive deny policy documents the intended direct-API boundary.
  - Default privileges prevent newly created public tables/functions/sequences
    from becoming reachable by API roles automatically.
*/

do $$
declare
  t text;
  tables text[] := array[
    'action_results',
    'ai_interventions',
    'allowable_limits',
    'challenge_stories',
    'checkins',
    'connection_events',
    'consent_records',
    'email_events',
    'fcl_users',
    'intervention_assignments',
    'intervention_outcomes',
    'intervention_policy_decisions',
    'intervention_results',
    'interventions',
    'journal_replies',
    'match_messages',
    'model_learning_events',
    'participants',
    'protected_assets',
    'strategy_changes',
    'support_resistance_logs',
    'supporter_matches',
    'supporter_outcomes',
    'supporters',
    'sustainability_scores'
  ];
begin
  foreach t in array tables loop
    execute format(
      'revoke all on table public.%I from public, anon, authenticated',
      t
    );

    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      t
    );

    if not exists (
      select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = t
        and p.polname = 'deny_direct_api_access'
    ) then
      execute format(
        'create policy deny_direct_api_access on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        t
      );
    end if;
  end loop;
end
$$;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
