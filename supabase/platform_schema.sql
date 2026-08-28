-- ================================================================
-- FALAH ACADEMY PARENT & SCHOOL OPERATIONS PLATFORM
-- Database schema v2 — implements FR-001 (School Database) and the
-- v1.1 ER diagram on Supabase (PostgreSQL + Row-Level Security).
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ================================================================

-- ---------------- Auth-linked profiles ----------------
-- Every login (admin or parent) has a profile. Teachers are records,
-- not logins, in Version 1 (they keep using Sheets/Drive per the PRD).
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  role text not null default 'parent' check (role in ('admin', 'parent')),
  phone text,
  preferred_language text not null default 'en',
  comm_preferences jsonb not null default '{}'::jsonb,
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------- Reference data ----------------
create table if not exists public.school_years (
  id serial primary key,
  label text unique not null,               -- '2026-2027'
  is_current boolean not null default false
);

create table if not exists public.grades (
  id serial primary key,
  name text unique not null,                -- 'Pre-K', 'KG', 'Grade 1', 'Grade 3'
  level_order int not null,
  is_active boolean not null default true
);

-- ---------------- Admissions domain (FR-014) ----------------
create table if not exists public.applicants (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  gender text,
  current_school text,
  applied_grade_id int references public.grades,
  school_year_id int references public.school_years,
  parent_name text,
  parent_email text,
  parent_phone text,
  application_date date not null default current_date,
  status text not null default 'under_review'
    check (status in ('under_review','accepted','waitlisted','not_accepted','deferred')),
  notes text,
  student_id uuid,                          -- set on conversion
  created_at timestamptz not null default now()
);

-- ---------------- Student domain (FR-001) ----------------
-- BR-201: permanent, never-reused Student ID (student_no).
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_no int generated always as identity (start with 10001) unique,
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  gender text,
  profile_photo_url text,
  archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

-- BR-202: one enrollment per academic year; grade/fee history lives here.
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students on delete cascade,
  school_year_id int not null references public.school_years,
  grade_id int not null references public.grades,
  school_year text not null,                -- denormalized label for display
  grade_name text not null,
  enrollment_date date not null default current_date,
  admission_date date,
  status text not null default 'active'
    check (status in ('active','completed','withdrawn')),
  exit_date date,
  notes text,
  unique (student_id, school_year_id)
);

create table if not exists public.parent_students (
  parent_id uuid not null references public.profiles on delete cascade,
  student_id uuid not null references public.students on delete cascade,
  relationship text not null default 'parent',
  is_primary_contact boolean not null default false,
  primary key (parent_id, student_id)
);

-- BR-007: at least one emergency contact (enforced operationally + dashboard warning)
create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students on delete cascade,
  name text not null,
  phone text not null,
  relationship text,
  is_primary boolean not null default false,
  address text
);

create table if not exists public.medical_info (
  student_id uuid primary key references public.students on delete cascade,
  allergies text,
  medical_conditions text,
  medications text,
  physician_name text,
  physician_phone text,
  notes text
);

-- BR-009: files live in Google Drive; we store references only.
create table if not exists public.document_references (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students on delete cascade,
  document_type text not null,
  file_url text not null,
  uploaded_by uuid references public.profiles,
  uploaded_date timestamptz not null default now(),
  notes text
);

-- ---------------- Teachers (records, not logins, in V1) ----------------
create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  qualification text,
  hire_date date,
  active boolean not null default true
);

-- BR-098: teachers are assigned to grades; students follow automatically.
create table if not exists public.teacher_grades (
  id serial primary key,
  teacher_id uuid not null references public.teachers on delete cascade,
  grade_id int not null references public.grades on delete cascade,
  school_year_id int not null references public.school_years,
  role text not null default 'homeroom',    -- 'homeroom' | 'quran' | 'subject'
  unique (teacher_id, grade_id, school_year_id, role)
);

-- ---------------- Audit log (BR-100) ----------------
create table if not exists public.audit_log (
  id bigserial primary key,
  actor uuid references public.profiles,
  action text not null,
  entity text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  at timestamptz not null default now()
);

-- ---------------- Applicant -> Student conversion (BR-110) ----------------
create or replace function public.accept_applicant(p_applicant uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a record;
  sid uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select * into a from public.applicants where id = p_applicant;
  if a is null then raise exception 'applicant not found'; end if;
  if a.status = 'accepted' and a.student_id is not null then return a.student_id; end if;

  insert into public.students (first_name, last_name, date_of_birth, gender)
  values (a.first_name, a.last_name, a.date_of_birth, a.gender)
  returning id into sid;

  insert into public.enrollments (student_id, school_year_id, grade_id, school_year, grade_name, admission_date)
  select sid, a.school_year_id, a.applied_grade_id, y.label, g.name, current_date
  from public.school_years y, public.grades g
  where y.id = a.school_year_id and g.id = a.applied_grade_id;

  update public.applicants set status = 'accepted', student_id = sid where id = p_applicant;

  insert into public.audit_log (actor, action, entity, entity_id, new_value)
  values (auth.uid(), 'accept_applicant', 'applicant', p_applicant::text,
          jsonb_build_object('student_id', sid));
  return sid;
end; $$;

-- ---------------- Helpers ----------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.is_my_child(sid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.parent_students where parent_id = auth.uid() and student_id = sid) $$;

-- ---------------- Row-Level Security ----------------
do $$
declare t text;
begin
  foreach t in array array['profiles','school_years','grades','applicants','students',
    'enrollments','parent_students','emergency_contacts','medical_info',
    'document_references','teachers','teacher_grades','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles: self-read; admin everything
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- reference data: any signed-in user reads; admin writes
drop policy if exists school_years_read on public.school_years;
create policy school_years_read on public.school_years for select using (auth.uid() is not null);
drop policy if exists school_years_admin on public.school_years;
create policy school_years_admin on public.school_years for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists grades_read on public.grades;
create policy grades_read on public.grades for select using (auth.uid() is not null);
drop policy if exists grades_admin on public.grades;
create policy grades_admin on public.grades for all
  using (public.is_admin()) with check (public.is_admin());

-- admissions: admin only (parents interact via the public form -> edge function)
drop policy if exists applicants_admin on public.applicants;
create policy applicants_admin on public.applicants for all
  using (public.is_admin()) with check (public.is_admin());

-- students & child tables: admin all; parents read their own children
drop policy if exists students_select on public.students;
create policy students_select on public.students for select
  using (public.is_admin() or public.is_my_child(id));
drop policy if exists students_admin on public.students;
create policy students_admin on public.students for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments for select
  using (public.is_admin() or public.is_my_child(student_id));
drop policy if exists enrollments_admin on public.enrollments;
create policy enrollments_admin on public.enrollments for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists parent_students_select on public.parent_students;
create policy parent_students_select on public.parent_students for select
  using (parent_id = auth.uid() or public.is_admin());
drop policy if exists parent_students_admin on public.parent_students;
create policy parent_students_admin on public.parent_students for all
  using (public.is_admin()) with check (public.is_admin());

-- emergency contacts & medical info: admin all; parents read AND write for
-- their own children (BR-090: parent-managed fields)
drop policy if exists ec_select on public.emergency_contacts;
create policy ec_select on public.emergency_contacts for select
  using (public.is_admin() or public.is_my_child(student_id));
drop policy if exists ec_parent_write on public.emergency_contacts;
create policy ec_parent_write on public.emergency_contacts for all
  using (public.is_admin() or public.is_my_child(student_id))
  with check (public.is_admin() or public.is_my_child(student_id));

drop policy if exists mi_select on public.medical_info;
create policy mi_select on public.medical_info for select
  using (public.is_admin() or public.is_my_child(student_id));
drop policy if exists mi_parent_write on public.medical_info;
create policy mi_parent_write on public.medical_info for all
  using (public.is_admin() or public.is_my_child(student_id))
  with check (public.is_admin() or public.is_my_child(student_id));

-- documents: admin all; parents read their children's + upload references
drop policy if exists docs_select on public.document_references;
create policy docs_select on public.document_references for select
  using (public.is_admin() or public.is_my_child(student_id));
drop policy if exists docs_parent_insert on public.document_references;
create policy docs_parent_insert on public.document_references for insert
  with check (public.is_admin() or public.is_my_child(student_id));
drop policy if exists docs_admin on public.document_references;
create policy docs_admin on public.document_references for update
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists docs_admin_del on public.document_references;
create policy docs_admin_del on public.document_references for delete
  using (public.is_admin());

-- teachers: admin all; signed-in users may read basic info (parent portal shows teacher names)
drop policy if exists teachers_read on public.teachers;
create policy teachers_read on public.teachers for select using (auth.uid() is not null);
drop policy if exists teachers_admin on public.teachers;
create policy teachers_admin on public.teachers for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists tg_read on public.teacher_grades;
create policy tg_read on public.teacher_grades for select using (auth.uid() is not null);
drop policy if exists tg_admin on public.teacher_grades;
create policy tg_admin on public.teacher_grades for all
  using (public.is_admin()) with check (public.is_admin());

-- audit log: admin read; inserts happen via security-definer functions
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select using (public.is_admin());

-- ---------------- Seed reference data ----------------
insert into public.school_years (label, is_current) values ('2026-2027', true)
on conflict (label) do nothing;
insert into public.grades (name, level_order) values
  ('Pre-K', 1), ('KG', 2), ('Grade 1', 3), ('Grade 3', 5)
on conflict (name) do nothing;
