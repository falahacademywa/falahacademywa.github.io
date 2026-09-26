-- Phase 15 — Admin "Tasks" page: the school's working to-do list inside the portal
-- so any admin can see it (President's request 2026-09-26). $0 architecture: one
-- small table in the existing Supabase project, admin-only RLS, read by the portal.
-- Source of truth stays the hub's TODO.md; scripts/todo-sync.py regenerates
-- supabase/admin_tasks_sync.sql, which is run in the SQL editor after each change.

create table if not exists public.admin_tasks (
  code        text primary key,                 -- '3' for open rows, 'D30' for done rows
  task_no     int,                              -- numeric part, for sorting
  is_done     boolean not null default false,
  category    text not null default '',
  task        text not null,
  assigned_to text not null default '',
  due_text    text not null default '',         -- as written: '2026-09-29', 'next print', '—'
  due_date    date,                             -- parsed when due_text is an ISO date
  status      text not null default '',         -- 'Not started' | 'In progress' | 'Ready' | 'Waiting' | 'Parked' | 'On hold' | 'Done'
  done_on     date,
  source      text not null default 'TODO.md',
  updated_at  timestamptz not null default now()
);

alter table public.admin_tasks enable row level security;

drop policy if exists admin_tasks_admin on public.admin_tasks;
create policy admin_tasks_admin on public.admin_tasks
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.admin_tasks to authenticated;
