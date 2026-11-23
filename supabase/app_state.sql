-- Daily Command Centre + Cockpit extras storage.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
create table if not exists public.app_state (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.app_state enable row level security;

drop policy if exists "Own rows only" on public.app_state;
create policy "Own rows only" on public.app_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
