alter table public.participants
  add column if not exists archived_at timestamptz;

alter table public.supporters
  add column if not exists archived_at timestamptz;

create index if not exists participants_archived_at_idx on public.participants(archived_at);
create index if not exists supporters_archived_at_idx on public.supporters(archived_at);

-- Mark only clearly synthetic test domains as archived.
-- No participant/supporter learning records are deleted.
update public.participants
set archived_at = coalesce(archived_at, now())
where lower(split_part(trim(email), '@', 2)) in ('example.com','test.com');

update public.supporters
set archived_at = coalesce(archived_at, now())
where lower(split_part(trim(email), '@', 2)) in ('example.com','test.com');
