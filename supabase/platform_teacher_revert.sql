-- ================================================================
-- REVERT: Teacher Workspace (dev database cleanup)
-- Teachers do not log in — they keep using Google Sheets and Drive.
-- Run once in the DEV project's SQL Editor (production never had this;
-- the cleaned platform_schema_phase4.sql no longer creates it).
-- ================================================================

drop policy if exists students_teacher_select on public.students;
drop policy if exists enrollments_teacher_select on public.enrollments;
drop policy if exists qp_teacher on public.quran_progress;
drop policy if exists ap_teacher on public.academic_progress;

-- Assignment policies back to admin-write / parent-read
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

drop function if exists public.is_teacher_of_grade(int);
drop function if exists public.is_teacher();

alter table public.profiles drop column if exists teacher_id;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'parent'));
