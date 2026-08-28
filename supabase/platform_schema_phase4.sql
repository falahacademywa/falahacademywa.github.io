-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 4b schema
-- Assignments (FR-004), Teacher Workspace role, admission-form
-- intake, forced password change (BR-014).
-- Run AFTER phases 1-3. Re-runnable.
-- ================================================================

-- BR-014: force password change on first login
alter table public.profiles add column if not exists must_change_password boolean not null default false;
-- Parents may clear their own flag after changing their password
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------- Assignments (FR-004) ----------------
-- Teachers do NOT log in (PRD Principle 3): files come from Google Drive
-- via the sync script (service role bypasses RLS); manual entries are admin.
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  grade_id int references public.grades,          -- set for grade-wide
  enrollment_id uuid references public.enrollments, -- set for individual
  subject text not null default 'General',
  title text not null,
  instructions text,
  file_url text,                                   -- Google Drive link
  assigned_date date not null default current_date,
  due_date date,
  source text not null default 'manual' check (source in ('manual', 'drive')),
  drive_file_id text unique,                       -- upsert key for Drive sync
  created_by uuid references public.profiles,
  created_at timestamptz not null default now(),
  check (grade_id is not null or enrollment_id is not null)
);

alter table public.assignments enable row level security;

drop policy if exists asg_select on public.assignments;
create policy asg_select on public.assignments for select using (
  public.is_admin()
  or (grade_id is not null and public.has_child_in_grade(grade_id))
  or (enrollment_id is not null and public.enrollment_is_my_child(enrollment_id))
);

drop policy if exists asg_write on public.assignments;
create policy asg_write on public.assignments for insert
  with check (public.is_admin());

drop policy if exists asg_update on public.assignments;
create policy asg_update on public.assignments for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists asg_delete on public.assignments;
create policy asg_delete on public.assignments for delete
  using (public.is_admin());

-- BR-038: notify parents when a new assignment is created
create or replace function public.trg_assignment_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.enrollment_id is not null then
    perform public.notify_parents_of_student(
      (select student_id from public.enrollments where id = new.enrollment_id),
      'New assignment: ' || new.title,
      new.subject || coalesce(' — due ' || new.due_date, ''), 'info', '/parent');
  elsif new.grade_id is not null then
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    select distinct ps.parent_id, 'New assignment: ' || new.title,
      new.subject || coalesce(' — due ' || new.due_date, ''), 'info', '/parent'
    from public.parent_students ps
    join public.enrollments e on e.student_id = ps.student_id and e.status = 'active'
    where e.grade_id = new.grade_id;
  end if;
  return new;
end; $$;
drop trigger if exists assignment_notify on public.assignments;
create trigger assignment_notify after insert on public.assignments
  for each row execute function public.trg_assignment_notify();

-- ---------------- Admission form intake (BR-106) ----------------
alter table public.applicants add column if not exists applied_grade_text text;
alter table public.applicants add column if not exists details jsonb;

-- The public website inserts applicants directly (anon key, INSERT only,
-- no read-back). Constrained to fresh under_review records.
drop policy if exists applicants_public_insert on public.applicants;
create policy applicants_public_insert on public.applicants for insert
  to anon
  with check (status = 'under_review' and student_id is null);
