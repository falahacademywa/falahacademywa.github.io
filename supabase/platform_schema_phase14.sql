-- Phase 14 — Accept → Enroll creates the enrollment AND the fee plan (BR-110, BR-010)
-- Bug: website applicants arrive with school_year_id NULL (and often only applied_grade_text),
-- so the enrollment INSERT in accept_applicant matched zero rows and silently created a
-- student with no enrollment and no fee plan (bit twice: 2026-09-06 batch, student 10017 on 2026-09-15).
-- Fix: default to the current school year, refuse to accept without a grade, create the fee plan,
-- and fail loudly if anything is missing. Returns a JSON summary for the Admissions UI.
--
-- Run in the DEV SQL editor first, test at the dev portal (Admin → Admissions → Accept → Enroll),
-- then mirror to website/supabase/ and run in PROD.

drop function if exists public.accept_applicant(uuid);
drop function if exists public.accept_applicant(uuid, numeric);

create or replace function public.accept_applicant(p_applicant uuid, p_monthly_fee numeric default 300)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a      record;
  sid    uuid;
  sno    int;
  eid    uuid;
  fid    uuid;
  yid    int;
  ylabel text;
  gid    int;
  gname  text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_monthly_fee is null or p_monthly_fee < 0 then
    raise exception 'monthly fee must be 0 or more';
  end if;

  select * into a from public.applicants where id = p_applicant;
  if a is null then raise exception 'applicant not found'; end if;
  if a.status = 'accepted' and a.student_id is not null then
    select student_no into sno from public.students where id = a.student_id;
    return jsonb_build_object('student_id', a.student_id, 'student_no', sno, 'already_accepted', true);
  end if;

  -- School year: the applicant's, else the current one (website applicants carry none).
  yid := coalesce(a.school_year_id,
                  (select id from public.school_years where is_current order by id desc limit 1));
  if yid is null then raise exception 'no current school year is set'; end if;
  select label into ylabel from public.school_years where id = yid;

  -- Grade: the admin's "Recommended grade" pick, else an exact match on the text the family typed.
  select id, name into gid, gname from public.grades where id = a.applied_grade_id;
  if gid is null and a.applied_grade_text is not null then
    select id, name into gid, gname from public.grades
     where is_active and lower(name) = lower(trim(a.applied_grade_text)) limit 1;
  end if;
  if gid is null then
    raise exception 'Choose the recommended grade before accepting';
  end if;

  insert into public.students (first_name, last_name, date_of_birth, gender)
  values (a.first_name, a.last_name, a.date_of_birth, a.gender)
  returning id, student_no into sid, sno;

  insert into public.enrollments (student_id, school_year_id, grade_id, school_year, grade_name,
                                  enrollment_date, admission_date, status)
  values (sid, yid, gid, ylabel, gname, current_date, current_date, 'active')
  returning id into eid;

  insert into public.fee_plans (enrollment_id, plan_name, total_amount, billing_frequency, start_date, status, notes)
  values (eid,
          case when p_monthly_fee = 0 then 'No fee' else 'Standard' end,
          p_monthly_fee, 'monthly',
          date_trunc('month', current_date)::date, 'active',
          'Created by Accept → Enroll on ' || to_char(current_date, 'YYYY-MM-DD'))
  returning id into fid;

  update public.applicants
     set status = 'accepted', student_id = sid,
         applied_grade_id = gid, school_year_id = yid
   where id = p_applicant;

  insert into public.audit_log (actor, action, entity, entity_id, new_value)
  values (auth.uid(), 'accept_applicant', 'applicant', p_applicant::text,
          jsonb_build_object('student_id', sid, 'student_no', sno, 'enrollment_id', eid,
                             'fee_plan_id', fid, 'monthly_fee', p_monthly_fee,
                             'grade', gname, 'school_year', ylabel));

  return jsonb_build_object('student_id', sid, 'student_no', sno, 'enrollment_id', eid,
                            'fee_plan_id', fid, 'grade', gname, 'school_year', ylabel,
                            'monthly_fee', p_monthly_fee);
end; $$;

grant execute on function public.accept_applicant(uuid, numeric) to authenticated;

-- Sanity check after running: students that still have no enrollment (should be empty in prod
-- after the 2026-09-15 hand fix). Read-only.
-- select s.student_no, s.first_name, s.last_name
--   from public.students s left join public.enrollments e on e.student_id = s.id
--  where e.id is null and not s.archived;
