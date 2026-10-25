-- supabase/migrations/0008_keepalive_heartbeat.sql
-- A heartbeat the site Worker's daily Cron Trigger writes so the free-tier
-- project registers real database activity. The old GitHub Actions ping was an
-- anonymous read that RLS answered with an empty array, and the project paused
-- twice while it ran (around 2026-09-17 and 2026-10-02), so a read evidently
-- does not count. Additive: safe to apply before the Worker code ships.

create table if not exists public.keepalive_heartbeat (
  id smallint primary key default 1 check (id = 1),
  beat_at timestamptz not null default now(),
  beats bigint not null default 0
);

-- RLS on with no policies: nobody reads or writes the table directly.
-- keepalive_beat() below is the only way in.
alter table public.keepalive_heartbeat enable row level security;

-- Writes at most once an hour no matter who calls it, so the anon grant
-- cannot be used to hammer the database. Returns the last heartbeat time.
create or replace function public.keepalive_beat()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_beat timestamptz;
begin
  insert into public.keepalive_heartbeat as h (id, beat_at, beats)
  values (1, now(), 1)
  on conflict (id) do update
    set beat_at = now(), beats = h.beats + 1
    where h.beat_at < now() - interval '1 hour';
  select beat_at into last_beat from public.keepalive_heartbeat where id = 1;
  return last_beat;
end;
$$;

revoke all on function public.keepalive_beat() from public;
grant execute on function public.keepalive_beat() to anon, authenticated;
