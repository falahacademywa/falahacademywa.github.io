-- Phase 16 — Task attachments: documents behind a task, viewable from the portal (and the phone).
-- $0: a private Storage bucket in the existing project + a jsonb column on admin_tasks.
-- Files are uploaded by the hub's scripts/todo-sync.py (service key, outside the hub);
-- the portal shows them to admins through short-lived signed URLs.

alter table public.admin_tasks add column if not exists attachments jsonb not null default '[]'::jsonb;
-- attachments = [{"name": "2026-09-12_ESD_UI-Tax-Billing-Statement.pdf", "path": "74/2026-09-12_ESD_....pdf", "size": 753787}]

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-docs', 'task-docs', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists task_docs_admin_read on storage.objects;
create policy task_docs_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'task-docs' and public.is_admin());
-- Uploads/deletes happen with the service key only (no client-side write policy on purpose).
