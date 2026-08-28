-- ================================================================
-- DEV SEED — dummy data for testing the Operations Platform.
-- Run AFTER platform_schema.sql (and platform_schema_phase2.sql).
--
-- STEP 1 (dashboard, ~2 min): Authentication > Users > "Add user" >
--   "Create new user" (set password directly, no email sent):
--     admin@test.local   password: FalahAdmin1!
--     parent@test.local  password: FalahParent1!
-- STEP 2: run this whole file in the SQL Editor.
-- ================================================================

-- Dummy students
insert into public.students (first_name, last_name, date_of_birth, gender)
select * from (values
  ('Ahmed',  'Testfamily', date '2021-03-12', 'M'),
  ('Fatima', 'Testfamily', date '2020-06-25', 'F'),
  ('Yusuf',  'Othertest',  date '2019-01-08', 'M')
) v(fn, ln, dob, g)
where not exists (select 1 from public.students where last_name in ('Testfamily','Othertest'));

-- Enroll them in the current year
insert into public.enrollments (student_id, school_year_id, grade_id, school_year, grade_name)
select s.id, y.id, g.id, y.label, g.name
from public.students s
join public.school_years y on y.is_current
join public.grades g on g.name = case s.first_name
  when 'Ahmed' then 'Pre-K' when 'Fatima' then 'KG' else 'Grade 1' end
where s.last_name in ('Testfamily','Othertest')
on conflict (student_id, school_year_id) do nothing;

-- Emergency contacts + medical info for one student
insert into public.emergency_contacts (student_id, name, phone, relationship, is_primary)
select id, 'Test Parent', '(555) 010-2030', 'Father', true
from public.students where first_name = 'Ahmed' and last_name = 'Testfamily'
and not exists (select 1 from public.emergency_contacts ec where ec.student_id = students.id);

insert into public.medical_info (student_id, allergies)
select id, 'Peanuts (mild)' from public.students
where first_name = 'Fatima' and last_name = 'Testfamily'
on conflict (student_id) do nothing;

-- Dummy teachers (records only — no logins in V1)
insert into public.teachers (first_name, last_name, email, active)
select * from (values
  ('Sister', 'Homeroom', 'teacher1@test.local', true),
  ('Brother', 'Quran',   'quran@test.local',   true)
) v(fn, ln, em, a)
where not exists (select 1 from public.teachers where email like '%test.local');

insert into public.teacher_grades (teacher_id, grade_id, school_year_id, role)
select t.id, g.id, y.id, case when t.last_name = 'Quran' then 'quran' else 'homeroom' end
from public.teachers t
cross join public.grades g
join public.school_years y on y.is_current
where t.email like '%test.local'
  and (t.last_name = 'Quran' or g.name = 'Pre-K')
on conflict do nothing;

-- Dummy applicant waiting in admissions
insert into public.applicants (first_name, last_name, date_of_birth, applied_grade_id,
  school_year_id, parent_name, parent_email, parent_phone)
select 'Maryam', 'Applicant', date '2021-09-01', g.id, y.id,
  'Prospective Parent', 'prospect@test.local', '(555) 020-3040'
from public.grades g, public.school_years y
where g.name = 'Pre-K' and y.is_current
and not exists (select 1 from public.applicants where last_name = 'Applicant');

-- Promote the dashboard-created users and link the parent to children
update public.profiles set role = 'admin', full_name = 'Test Admin'
where id = (select id from auth.users where email = 'admin@test.local');

update public.profiles set full_name = 'Test Parent', phone = '(555) 010-2030'
where id = (select id from auth.users where email = 'parent@test.local');

insert into public.parent_students (parent_id, student_id, relationship, is_primary_contact)
select u.id, s.id, 'father', true
from auth.users u, public.students s
where u.email = 'parent@test.local' and s.last_name = 'Testfamily'
on conflict do nothing;

-- Sanity report
select 'students' as entity, count(*) from public.students
union all select 'enrollments', count(*) from public.enrollments
union all select 'teachers', count(*) from public.teachers
union all select 'applicants', count(*) from public.applicants
union all select 'admin users', count(*) from public.profiles where role = 'admin'
union all select 'parent links', count(*) from public.parent_students;
