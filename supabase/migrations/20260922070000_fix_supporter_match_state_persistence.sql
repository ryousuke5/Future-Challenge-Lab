-- Persist the full supporter match state used by the FCL approval flow.
begin;

alter table public.supporter_matches
  drop constraint if exists supporter_matches_status_check;

update public.supporter_matches
set status = case
  when status = 'connected'
    or connected_at is not null
    or coalesce((meta->'approvals'->>'challenger')::boolean, false)
       and coalesce((meta->'approvals'->>'supporter')::boolean, false)
    then 'connected'
  when status = 'declined' or declined_at is not null
    then 'declined'
  when status = 'expired' or expired_at is not null
    then 'expired'
  when status in ('challenger_approved','supporter_approved')
    or challenger_approved_at is not null
    or coalesce((meta->'approvals'->>'challenger')::boolean, false)
    then 'challenger_approved'
  when supporter_approved_at is not null
    or coalesce((meta->'approvals'->>'supporter')::boolean, false)
    then 'supporter_approved'
  else 'pending'
end;

alter table public.supporter_matches
  alter column status set default 'pending';

alter table public.supporter_matches
  add constraint supporter_matches_status_check
  check (status in ('pending','challenger_approved','supporter_approved','connected','declined','expired'));

commit;
