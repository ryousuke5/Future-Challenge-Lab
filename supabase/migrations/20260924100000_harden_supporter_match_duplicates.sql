-- FCL supporter-match integrity hardening
-- Keep historical declined/expired records, but ensure at most one active
-- waiting/request record exists for each participant/supporter pair.

begin;

with base as (
  select
    sm.id,
    sm.participant_id,
    sm.supporter_id,
    sm.status,
    sm.created_at,
    count(*) filter (where sm.status='connected')
      over (partition by sm.participant_id, sm.supporter_id) as connected_count
  from supporter_matches sm
  where sm.status in ('pending','challenger_approved','supporter_approved','connected')
),
ranked_waiting as (
  select
    id,
    connected_count,
    row_number() over (
      partition by participant_id, supporter_id
      order by created_at desc nulls last, id desc
    ) as waiting_rank
  from base
  where status in ('pending','challenger_approved','supporter_approved')
),
to_expire as (
  select id,
         case
           when connected_count > 0 then 'active connection already exists for this pair'
           else 'superseded duplicate active match'
         end as reconcile_reason
  from ranked_waiting
  where connected_count > 0 or waiting_rank > 1
)
update supporter_matches sm
set
  status='expired',
  expired_at=coalesce(sm.expired_at, now()),
  updated_at=now(),
  meta=coalesce(sm.meta,'{}'::jsonb) ||
       jsonb_build_object(
         'reconciled_duplicate', true,
         'reconciled_at', now(),
         'reconciled_reason', to_expire.reconcile_reason
       )
from to_expire
where sm.id=to_expire.id;

create unique index if not exists uq_supporter_matches_active_pair
  on supporter_matches(participant_id, supporter_id)
  where status in ('pending','challenger_approved','supporter_approved');

commit;
