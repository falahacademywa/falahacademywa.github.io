-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 12: parent activity tracking
-- 1. portal_events: the parent portal logs what each parent opens
--    (dashboard, child tabs, calendar, documents, ...). Admin reads it
--    for the Parents grid and the drill-down activity report.
-- 2. admin_parent_logins(): exposes auth.users.last_sign_in_at to
--    admins (real login times, available retroactively).
-- Run in dev AND prod. Re-runnable.
-- ================================================================

create table if not exists public.portal_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles on delete cascade,
  event text not null,
  detail text,
  occurred_at timestamptz not null default now()
);
create index if not exists portal_events_user_time
  on public.portal_events (user_id, occurred_at desc);

alter table public.portal_events enable row level security;

drop policy if exists pev_insert on public.portal_events;
create policy pev_insert on public.portal_events for insert
  with check (user_id = auth.uid());

drop policy if exists pev_select on public.portal_events;
create policy pev_select on public.portal_events for select
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists pev_admin_delete on public.portal_events;
create policy pev_admin_delete on public.portal_events for delete
  using (public.is_admin());

-- True sign-in times from Supabase auth (admins only; empty for others)
create or replace function public.admin_parent_logins()
returns table (user_id uuid, email text, last_sign_in_at timestamptz)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, u.last_sign_in_at
  from auth.users u
  where public.is_admin();
$$;

-- Per-parent activity summary for the report (admins only)
create or replace function public.admin_parent_activity()
returns table (user_id uuid, full_name text, events_count bigint,
               days_active bigint, last_event_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.full_name,
         count(e.id) as events_count,
         count(distinct (e.occurred_at at time zone 'America/Los_Angeles')::date) as days_active,
         max(e.occurred_at) as last_event_at
  from public.profiles p
  left join public.portal_events e on e.user_id = p.id
  where public.is_admin() and p.role = 'parent'
  group by p.id, p.full_name;
$$;
