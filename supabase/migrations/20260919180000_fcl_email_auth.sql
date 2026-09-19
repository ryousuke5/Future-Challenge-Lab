/*
  FCL email authentication support
  - Store only a hash of the short-lived email verification code.
  - Codes expire after 10 minutes and are limited to 5 verification attempts.
  - Browser sessions are signed server-side; no session secret is stored in the browser.
*/
alter table public.fcl_users
  add column if not exists auth_code_hash text,
  add column if not exists auth_code_expires_at timestamptz,
  add column if not exists auth_code_sent_at timestamptz,
  add column if not exists auth_code_attempts integer not null default 0;

revoke all on table public.fcl_users from public, anon, authenticated;
grant select, insert, update, delete on table public.fcl_users to service_role;
