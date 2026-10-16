-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 25: Accept → Enroll and website applications dated in Pacific time
-- UTC audit 2026-10-09, TODO #116 and #117. Supabase's current_date is the UTC
-- date, so anything done after ~5 PM Pacific was dated tomorrow:
--   #116 accept_applicant: enrollment date, admission date, the fee plan's start
--        month and the "Created by Accept → Enroll on" note;
--   #117 applicants.application_date default (the website form sends no date).
-- Same body as phase 23 (family copy included) — only the date source changes.
-- Run in dev AND prod. Re-runnable. Changes no existing rows.
-- ================================================================

-- ---------- #117: website applications ----------
alter table public.applicants
  alter column application_date set default (now() at time zone 'America/Los_Angeles')::date;

-- ---------- #116: accept_applicant (phase 23 body, Pacific date) ----------
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
  fam    jsonb;
  today  date := (now() at time zone 'America/Los_Angeles')::date;  -- Pacific, not UTC (#116)
begin
  if not public.can_edit('admissions') then
    raise exception 'admissions permission required';
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

  yid := coalesce(a.school_year_id,
                  (select id from public.school_years where is_current order by id desc limit 1));
  if yid is null then raise exception 'no current school year is set'; end if;
  select label into ylabel from public.school_years where id = yid;

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
  values (sid, yid, gid, ylabel, gname, today, today, 'active')
  returning id into eid;

  insert into public.fee_plans (enrollment_id, plan_name, total_amount, billing_frequency, start_date, status, notes)
  values (eid,
          case when p_monthly_fee = 0 then 'No fee' else 'Standard' end,
          p_monthly_fee, 'monthly',
          date_trunc('month', today)::date, 'active',
          'Created by Accept → Enroll on ' || to_char(today, 'YYYY-MM-DD'))
  returning id into fid;

  update public.applicants
     set status = 'accepted', student_id = sid,
         applied_grade_id = gid, school_year_id = yid
   where id = p_applicant;

  fam := public.copy_applicant_family(p_applicant);

  insert into public.audit_log (actor, action, entity, entity_id, new_value)
  values (auth.uid(), 'accept_applicant', 'applicant', p_applicant::text,
          jsonb_build_object('student_id', sid, 'student_no', sno, 'enrollment_id', eid,
                             'fee_plan_id', fid, 'monthly_fee', p_monthly_fee,
                             'grade', gname, 'school_year', ylabel, 'family', fam));

  return jsonb_build_object('student_id', sid, 'student_no', sno, 'enrollment_id', eid,
                            'fee_plan_id', fid, 'grade', gname, 'school_year', ylabel,
                            'monthly_fee', p_monthly_fee, 'family', fam);
end; $$;
grant execute on function public.accept_applicant(uuid, numeric) to authenticated;

-- Check 1: the column default should show the America/Los_Angeles expression
select column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'applicants' and column_name = 'application_date';
-- Check 2: should return true (the function now carries the Pacific date)
select position('America/Los_Angeles' in pg_get_functiondef('public.accept_applicant(uuid, numeric)'::regprocedure)) > 0 as accept_uses_pacific;
