-- Memo: one row per Deepgram streaming token handed out, so the
-- deepgram-token function can rate-limit per caller. Only the function
-- (service role) touches it: RLS on, and no policies for anon or users.
create table if not exists public.memo_token_grants (
  id bigint generated always as identity primary key,
  caller text not null,
  created_at timestamptz not null default now()
);

create index if not exists memo_token_grants_caller_time
  on public.memo_token_grants (caller, created_at desc);

alter table public.memo_token_grants enable row level security;

revoke all on public.memo_token_grants from anon, authenticated;
