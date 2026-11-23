-- Apple Reminders via iOS Shortcuts.
-- Each user creates a Shortcut key in the dashboard; only its SHA-256 hash is stored.
-- The Shortcut posts reminders to /api/reminders, which calls push_reminders()
-- with the key's hash; the function files them under the key's owner in app_state.
create table if not exists public.shortcut_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.shortcut_keys enable row level security;
drop policy if exists "Own key only" on public.shortcut_keys;
create policy "Own key only" on public.shortcut_keys
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.push_reminders(p_key_hash text, p_items jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid;
begin
  if p_key_hash is null or length(p_key_hash) <> 64 or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    return false;
  end if;
  select user_id into v_user from shortcut_keys where key_hash = p_key_hash;
  if v_user is null then
    return false;
  end if;
  insert into app_state (user_id, key, value, updated_at)
  values (v_user, 'apple_reminders', jsonb_build_object('items', p_items, 'receivedAt', now()), now())
  on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
  return true;
end;
$fn$;
revoke all on function public.push_reminders(text, jsonb) from public;
grant execute on function public.push_reminders(text, jsonb) to anon, authenticated;
