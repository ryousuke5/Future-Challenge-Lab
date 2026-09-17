create table if not exists public.match_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.supporter_matches(id) on delete cascade,
  sender_role text not null check (sender_role in ('challenger','supporter')),
  sender_id uuid not null,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists idx_match_messages_match_created
  on public.match_messages(match_id, created_at asc);

alter table public.match_messages enable row level security;

comment on table public.match_messages is 'FCLの支援接続成立後に、挑戦者と支援者がやり取りするメッセージ履歴。APIサーバー経由のみで利用する。';
comment on column public.match_messages.sender_role is 'メッセージ送信者の役割。challenger または supporter。';
comment on column public.match_messages.sender_id is '送信者の参加者IDまたは支援者ID。';
