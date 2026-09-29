-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 20: tasks created from the portal (phone)
-- Admin → Tasks gets "+ New task": the row is saved with source = 'portal'
-- and a temporary code P<n>; photos/files go to the private task-docs bucket
-- under inbox/P<n>/. The hub's scripts/todo-sync.py --pull (hourly on the
-- President's computer, or on demand) copies such rows into TODO.md with a
-- real number, moves the files into the records Inbox folder and removes the
-- portal row and its bucket files. (President's request 2026-09-28.)
-- Run in dev AND prod. Re-runnable.
-- ================================================================

alter table public.admin_tasks
  add column if not exists created_by uuid references public.profiles,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists notes text;

create sequence if not exists public.admin_tasks_portal_seq;

-- next temporary code for a portal-created task ("P1", "P2", …)
create or replace function public.next_portal_task_code()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit('tasks') then
    raise exception 'tasks permission required';
  end if;
  return 'P' || nextval('public.admin_tasks_portal_seq');
end; $$;
grant execute on function public.next_portal_task_code() to authenticated;

-- the portal may upload (and tidy up) files only under inbox/; the hub's
-- service key handles everything else in this bucket
drop policy if exists task_docs_inbox_insert on storage.objects;
create policy task_docs_inbox_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-docs' and public.can_edit('tasks') and name like 'inbox/%');
drop policy if exists task_docs_inbox_delete on storage.objects;
create policy task_docs_inbox_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-docs' and public.can_edit('tasks') and name like 'inbox/%');
