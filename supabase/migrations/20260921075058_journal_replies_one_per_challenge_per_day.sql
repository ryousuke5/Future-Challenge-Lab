-- One FCL journal reply per active challenge per JST calendar day.
-- Existing duplicate rows are reduced to the latest reply before the constraint is added.

begin;

with ranked as (
  select
    id,
    row_number() over (
      partition by participant_id, reply_date
      order by created_at desc nulls last, id desc
    ) as rn
  from public.journal_replies
)
delete from public.journal_replies jr
using ranked r
where jr.id = r.id
  and r.rn > 1;

alter table public.journal_replies
  drop constraint if exists journal_replies_one_per_analysis;

alter table public.journal_replies
  drop constraint if exists journal_replies_one_per_participant_day;

alter table public.journal_replies
  add constraint journal_replies_one_per_participant_day
  unique (participant_id, reply_date);

commit;
