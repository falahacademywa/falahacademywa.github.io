-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 31 (President 2026-10-31)
--   1. Red Comet becomes its own staff permission module ('redcomet').
--      view = see the photos; edit = upload and delete (nothing else to edit).
--      Until now Red Comet sat under 'academics'. Existing staff who could see
--      academics get Red Comet at the same level is NOT assumed: grants are
--      made on the Staff & Permissions screen (the one staff login gets edit
--      by this script, as decided).
--   2. Deleting Red Comet photos: admins, staff with redcomet edit and the
--      teacher of that grade may delete a photo (row + image) — but only while
--      it is NOT yet entered in Red Comet (status <> 'confirmed'). Enforced by
--      a trigger, for every login. Every delete leaves a tombstone row in
--      work_upload_deletions so scripts/redcomet-pull.py can remove the
--      OneDrive copy on its next hourly run.
--   3. Photo check (GitHub Actions + CLIP, hourly): work_uploads gains
--      check_status pending → ok | flagged; flagged → cleared ("It is school
--      work"). record_photo_check() stores the verdict and, for a flagged
--      photo, notifies the uploader, the grade's teachers, every admin and
--      staff with redcomet edit. The pull script only copies ok/cleared photos
--      (or pending ones older than 6 hours, so a broken check never blocks).
--   4. Task delegation: admin_tasks.assigned_user (a login), assign_pending
--      (portal reassignment of a TODO.md task waiting for the hub to apply it),
--      staff see ONLY tasks assigned to them, a notification on (re)assignment,
--      task_assignees() for the picker. Teachers are not assignable for now.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. Red Comet module: staff policies ----------
drop policy if exists staff_work_uploads_view on public.work_uploads;
create policy staff_work_uploads_view on public.work_uploads for select using (public.can_view('redcomet'));
drop policy if exists staff_work_uploads_edit on public.work_uploads;
create policy staff_work_uploads_edit on public.work_uploads for all
  using (public.can_edit('redcomet')) with check (public.can_edit('redcomet'));

drop policy if exists student_work_teacher_insert on storage.objects;
create policy student_work_teacher_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'student-work' and (public.is_admin() or public.is_teacher() or public.can_edit('redcomet')));
drop policy if exists student_work_read on storage.objects;
create policy student_work_read on storage.objects for select to authenticated
  using (bucket_id = 'student-work' and (public.is_admin() or public.is_teacher() or public.can_view('redcomet')));
-- delete: admin, staff with edit, the uploader, or a teacher of the student's grade
-- (object names are <enrollment id>/<yyyy-mm-dd>/<file>.jpg)
drop policy if exists student_work_delete on storage.objects;
create policy student_work_delete on storage.objects for delete to authenticated
  using (bucket_id = 'student-work' and (
    public.is_admin() or public.can_edit('redcomet') or owner = auth.uid()
    or exists (select 1 from public.enrollments e
                where e.id::text = (storage.foldername(name))[1] and public.teaches_enrollment(e.id))));

-- staff who could see Red Comet before (it sat under Academics) get the new module at edit,
-- as decided 2026-10-31; a re-run never overrides a level set later on the Staff screen
insert into public.staff_permissions (user_id, module, level)
select sp.user_id, 'redcomet', 'edit' from public.staff_permissions sp
  join public.profiles p on p.id = sp.user_id and p.role = 'staff'
 where sp.module = 'academics'
on conflict (user_id, module) do nothing;

-- ---------- 2. delete guard + tombstones ----------
create table if not exists public.work_upload_deletions (
  id          bigint primary key,          -- the work_uploads id that was deleted
  path        text not null,
  enrollment_id uuid,
  status      text,
  onedrive    text,                         -- draft_entry->>'onedrive' when it had been pulled
  deleted_by  uuid references public.profiles on delete set null,
  deleted_at  timestamptz not null default now(),
  cleaned_at  timestamptz                   -- set by redcomet-pull.py once the OneDrive copy is gone
);
alter table public.work_upload_deletions enable row level security;
drop policy if exists wud_admin on public.work_upload_deletions;
create policy wud_admin on public.work_upload_deletions for select using (public.is_admin());
grant select on public.work_upload_deletions to authenticated;
grant all on public.work_upload_deletions to service_role;

create or replace function public.work_uploads_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the service role (scripts, SQL editor maintenance) is not limited
  if auth.uid() is not null and old.status = 'confirmed' then
    raise exception 'This photo is already entered in Red Comet and cannot be deleted.';
  end if;
  insert into public.work_upload_deletions (id, path, enrollment_id, status, onedrive, deleted_by)
  values (old.id, old.path, old.enrollment_id, old.status, old.draft_entry ->> 'onedrive', auth.uid())
  on conflict (id) do nothing;
  return old;
end; $$;
drop trigger if exists work_uploads_before_delete on public.work_uploads;
create trigger work_uploads_before_delete before delete on public.work_uploads
  for each row execute function public.work_uploads_before_delete();

-- ---------- 3. photo check ----------
alter table public.work_uploads add column if not exists check_status text not null default 'pending';
alter table public.work_uploads add column if not exists check_label  text;
alter table public.work_uploads add column if not exists check_score  numeric;
alter table public.work_uploads add column if not exists checked_at   timestamptz;
alter table public.work_uploads add column if not exists cleared_by   uuid references public.profiles on delete set null;
alter table public.work_uploads drop constraint if exists work_uploads_check_status_check;
alter table public.work_uploads add constraint work_uploads_check_status_check
  check (check_status in ('pending', 'ok', 'flagged', 'cleared'));
-- photos that already went through the office before the check existed count as ok
update public.work_uploads set check_status = 'ok', checked_at = coalesce(checked_at, now())
 where check_status = 'pending' and status <> 'new';
create index if not exists work_uploads_check_pending on public.work_uploads (id) where check_status = 'pending';

-- "It is school work": stamp who cleared it
create or replace function public.work_uploads_clear_stamp()
returns trigger language plpgsql as $$
begin
  if new.check_status = 'cleared' and old.check_status is distinct from 'cleared' then
    new.cleared_by := auth.uid();
    new.checked_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists work_uploads_clear_stamp on public.work_uploads;
create trigger work_uploads_clear_stamp before update of check_status on public.work_uploads
  for each row execute function public.work_uploads_clear_stamp();

-- Called by the photo-check workflow (service role) once per checked photo.
-- Returns the notifications it created (id + e-mail) so the workflow can e-mail them.
create or replace function public.record_photo_check(p_id bigint, p_ok boolean, p_label text, p_score numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; who uuid; notes jsonb := '[]'::jsonb; nid bigint; em text; nm text;
        sname text; gname text;
begin
  select wu.*, s.first_name, g.name as grade_name into w
    from public.work_uploads wu
    join public.enrollments e on e.id = wu.enrollment_id
    join public.students s on s.id = e.student_id
    join public.grades g on g.id = e.grade_id
   where wu.id = p_id;
  if w is null then return jsonb_build_object('found', false); end if;
  if w.check_status <> 'pending' then return jsonb_build_object('found', true, 'skipped', w.check_status); end if;
  update public.work_uploads
     set check_status = case when p_ok then 'ok' else 'flagged' end,
         check_label = p_label, check_score = p_score, checked_at = now()
   where id = p_id;
  if p_ok then return jsonb_build_object('found', true, 'flagged', false); end if;

  sname := btrim(w.first_name); gname := w.grade_name;
  for who in
    select distinct x.uid from (
      select w.uploaded_by as uid
      union select t.user_id from public.teachers t
              join public.teacher_grades tg on tg.teacher_id = t.id
              join public.school_years y on y.id = tg.school_year_id and y.is_current
              join public.enrollments e on e.id = w.enrollment_id and e.grade_id = tg.grade_id
             where t.user_id is not null and t.app_access and t.active
      union select p.id from public.profiles p where p.role = 'admin'
      union select sp.user_id from public.staff_permissions sp where sp.module = 'redcomet' and sp.level = 'edit'
    ) x where x.uid is not null
  loop
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    values (who, 'Red Comet photo needs a look',
            'A ' || coalesce(w.subject, 'workbook') || ' photo for ' || sname || ' (' || gname || ', ' || to_char(w.taken_at, 'Mon DD') ||
            ') does not look like a workbook page (' || coalesce(p_label, 'unclear') || '). Open it and delete it, or mark it as school work. It will not go to the office until then.',
            'action',
            case when exists (select 1 from public.profiles where id = who and role in ('admin', 'staff'))
                 then '/admin/redcomet?check=flagged' else '/teacher/progress?student=' || w.enrollment_id end)
    returning id into nid;
    select email, full_name into em, nm from public.profiles where id = who;
    notes := notes || jsonb_build_object('id', nid, 'email', em, 'name', nm);
  end loop;
  return jsonb_build_object('found', true, 'flagged', true, 'student', sname, 'grade', gname,
                            'subject', w.subject, 'taken_at', w.taken_at, 'path', w.path, 'notifications', notes);
end; $$;
revoke all on function public.record_photo_check(bigint, boolean, text, numeric) from public, anon, authenticated;
grant execute on function public.record_photo_check(bigint, boolean, text, numeric) to service_role;

-- ---------- 4. task delegation ----------
alter table public.admin_tasks add column if not exists assigned_user uuid references public.profiles on delete set null;
alter table public.admin_tasks add column if not exists assign_pending boolean not null default false;
create index if not exists admin_tasks_assigned_user on public.admin_tasks (assigned_user) where assigned_user is not null;

-- staff: only their own tasks (phase 19 gave every task to anyone with the module)
drop policy if exists staff_admin_tasks_view on public.admin_tasks;
create policy staff_admin_tasks_view on public.admin_tasks for select
  using (public.can_view('tasks') and assigned_user = auth.uid());
drop policy if exists staff_admin_tasks_edit on public.admin_tasks;
drop policy if exists staff_admin_tasks_insert on public.admin_tasks;
create policy staff_admin_tasks_insert on public.admin_tasks for insert
  with check (public.can_edit('tasks') and source = 'portal');
drop policy if exists staff_admin_tasks_delete on public.admin_tasks;
create policy staff_admin_tasks_delete on public.admin_tasks for delete
  using (public.can_edit('tasks') and source = 'portal' and assigned_user = auth.uid());

-- people a task can be given to (admins and staff, not suspended)
create or replace function public.task_assignees()
returns table (id uuid, full_name text, title text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.title, p.role from public.profiles p
   where p.role in ('admin', 'staff') and not coalesce(p.suspended, false) and public.can_view('tasks')
   order by p.role, p.full_name
$$;
grant execute on function public.task_assignees() to authenticated;

-- notify the person a task is (re)assigned to, unless they assigned it to themselves
create or replace function public.admin_tasks_assign_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_user is not null and not new.is_done
     and (tg_op = 'INSERT' or new.assigned_user is distinct from old.assigned_user)
     and new.assigned_user is distinct from auth.uid() then
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    values (new.assigned_user, 'Task assigned to you: ' || new.code,
            left(regexp_replace(new.task, '\*\*|`', '', 'g'), 240)
              || case when new.due_date is not null then ' — due ' || to_char(new.due_date, 'Mon DD') else '' end,
            'important', '/admin/tasks?task=' || new.code);
  end if;
  return new;
end; $$;
drop trigger if exists admin_tasks_assign_notify on public.admin_tasks;
create trigger admin_tasks_assign_notify after insert or update of assigned_user on public.admin_tasks
  for each row execute function public.admin_tasks_assign_notify();
