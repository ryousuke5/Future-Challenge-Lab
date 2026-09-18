-- FCL共通ユーザーIDへの統一
-- 既存のparticipants.id / supporters.idは履歴・内部参照互換のため保持する。
create table if not exists public.fcl_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fcl_users enable row level security;
revoke all on public.fcl_users from anon, authenticated;

alter table public.participants add column if not exists user_id uuid;
alter table public.supporters add column if not exists user_id uuid;

create index if not exists participants_user_id_idx on public.participants(user_id);
create index if not exists supporters_user_id_idx on public.supporters(user_id);

insert into public.fcl_users (email, email_normalized)
select normalized, normalized
from (
  select lower(trim(email)) as normalized from public.participants where nullif(trim(email),'') is not null
  union
  select lower(trim(email)) as normalized from public.supporters where nullif(trim(email),'') is not null
) emails
where normalized <> ''
on conflict (email_normalized) do nothing;

update public.participants p
set user_id = u.id
from public.fcl_users u
where p.user_id is null
  and lower(trim(p.email)) = u.email_normalized;

update public.supporters s
set user_id = u.id
from public.fcl_users u
where s.user_id is null
  and lower(trim(s.email)) = u.email_normalized;

alter table public.participants alter column user_id set not null;
alter table public.supporters alter column user_id set not null;

alter table public.participants drop constraint if exists participants_user_id_fkey;
alter table public.supporters drop constraint if exists supporters_user_id_fkey;

alter table public.participants
  add constraint participants_user_id_fkey
  foreign key (user_id) references public.fcl_users(id);

alter table public.supporters
  add constraint supporters_user_id_fkey
  foreign key (user_id) references public.fcl_users(id);

comment on table public.fcl_users is 'FCL共通ユーザー。挑戦者・支援者の両ロールで同一人物を1つのuser_idとして扱う。現行MVPでは正規化メールアドレスを同一人物判定キーとする。';
comment on column public.participants.user_id is 'FCL共通ユーザーID。participants.idは履歴互換の内部ロールIDとして保持する。';
comment on column public.supporters.user_id is 'FCL共通ユーザーID。supporters.idは履歴互換の内部ロールIDとして保持する。';
