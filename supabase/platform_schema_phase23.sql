-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 23: Accept → Enroll copies the family
-- President's report 2026-10-08: a student accepted through Admin → Admissions
-- showed "No parents on file yet" and "No emergency contact on file (BR-007)".
-- accept_applicant (phase 14/19) created the student, enrollment and fee plan
-- but never copied the parents or the emergency contact from the application.
--
--   1. accept_applicant now also inserts
--        guardians          father (parent_name/email/phone, sort 1)
--                           mother (details.mother / mother_phone, sort 2)
--        emergency_contacts from details.emergency_name/_relationship/_phone
--                           (website form since 2026-10-08), else parsed from
--                           the older combined "Name (Relationship) Phone" text
--        parent_students    when a portal login with the father's e-mail
--                           already exists (a sibling's parent, or an account
--                           made before Accept) it is linked at once
--   2. One-time backfill: every accepted applicant whose student still has no
--      guardians / no emergency contact gets them from the application.
-- Run in dev AND prod. Re-runnable (inserts skip rows that already exist).
-- ================================================================

-- ---------- helper: the application's emergency contact as (name, relationship, phone) ----------
create or replace function public.applicant_emergency(d jsonb)
returns table (name text, relationship text, phone text)
language sql immutable as $$
  select coalesce(nullif(trim(d->>'emergency_name'), ''), nullif(trim(m[1]), '')),
         coalesce(nullif(trim(d->>'emergency_relationship'), ''), nullif(trim(m[2]), '')),
         coalesce(nullif(trim(d->>'emergency_phone'), ''), nullif(trim(m[3]), ''))
    from (select regexp_match(coalesce(d->>'emergency', ''), '^([^(]*)\(([^)]*)\)(.*)$') as m) x
   where coalesce(nullif(trim(d->>'emergency_name'), ''), nullif(trim(m[1]), '')) is not null
     and coalesce(nullif(trim(d->>'emergency_phone'), ''), nullif(trim(m[3]), '')) is not null;
$$;

-- ---------- helper: copy guardians + emergency contact + login link for one student ----------
create or replace function public.copy_applicant_family(p_applicant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a   record;
  ng  int := 0;
  ne  int := 0;
  nl  int := 0;
begin
  select * into a from public.applicants where id = p_applicant;
  if a is null or a.student_id is null then return jsonb_build_object('skipped', true); end if;

  if nullif(trim(a.parent_name), '') is not null
     and not exists (select 1 from public.guardians where student_id = a.student_id and sort = 1) then
    insert into public.guardians (student_id, name, relationship, phone, email, sort)
    values (a.student_id, trim(a.parent_name), 'father', a.parent_phone, lower(trim(a.parent_email)), 1);
    ng := ng + 1;
  end if;

  if nullif(trim(a.details->>'mother'), '') is not null
     and not exists (select 1 from public.guardians where student_id = a.student_id and sort = 2) then
    insert into public.guardians (student_id, name, relationship, phone, sort)
    values (a.student_id, trim(a.details->>'mother'), 'mother', a.details->>'mother_phone', 2);
    ng := ng + 1;
  end if;

  if not exists (select 1 from public.emergency_contacts where student_id = a.student_id) then
    insert into public.emergency_contacts (student_id, name, relationship, phone, is_primary)
    select a.student_id, e.name, e.relationship, e.phone, true
      from public.applicant_emergency(a.details) e;
    get diagnostics ne = row_count;
  end if;

  if nullif(trim(a.parent_email), '') is not null then
    insert into public.parent_students (parent_id, student_id, relationship, is_primary_contact)
    select p.id, a.student_id, 'parent', true
      from public.profiles p
     where p.role = 'parent' and lower(p.email) = lower(trim(a.parent_email))
    on conflict do nothing;
    get diagnostics nl = row_count;
  end if;

  return jsonb_build_object('guardians', ng, 'emergency_contacts', ne, 'login_linked', nl);
end; $$;
revoke all on function public.copy_applicant_family(uuid) from public, anon, authenticated;

-- ---------- accept_applicant: phase 19 body + the family copy ----------
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

-- ---------- one-time backfill for students accepted before this phase ----------
select s.student_no, s.first_name, public.copy_applicant_family(a.id) as copied
  from public.applicants a
  join public.students s on s.id = a.student_id
 where a.status = 'accepted'
   and (not exists (select 1 from public.guardians g where g.student_id = s.id)
        or not exists (select 1 from public.emergency_contacts e where e.student_id = s.id))
 order by s.student_no;
