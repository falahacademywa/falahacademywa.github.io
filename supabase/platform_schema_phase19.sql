-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 19: Staff role with per-module permissions
-- A third role, "staff", for helpers who run part of the school without full
-- admin rights (President's request 2026-09-28). Permissions are enforced
-- HERE, in row-level security, not just in the menus:
--   staff_permissions(user_id, module, level)  level = 'view' | 'edit'
--   can_view(module) / can_edit(module)        admins always pass
-- Every table gets two ADDITIONAL permissive policies (existing admin and
-- parent policies are untouched): staff read when they may view the module,
-- staff write when they may edit it. Modules:
--   students     students, enrollments, guardians, emergency_contacts,
--                document_references, attendance, student-documents bucket
--   health       medical_info, media_consent
--   admissions   applicants, accept_applicant()
--   parents      parent profiles, parent_students, portal_events, login report
--   teachers     teachers, teacher_grades
--   fees         fee_plans, payments
--   academics    quran_progress, academic_progress, assignments, class_updates
--   calendar     calendar_events (+ read event_rsvps)
--   announcements announcements (+ read announcement_acks)
--   feedback     feedback
--   reports      (menu only; data comes through the modules above)
--   tasks        admin_tasks, task-docs bucket (read)
--   settings     school_years, grades, document_types; permissions stay admin-only
-- profiles.title is the person's display title ("Office Staff", "Principal").
-- audit_log and staff_permissions remain admin-only. Admin alerts
-- (notify_admins) still go to full admins only.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- role + title ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'parent', 'staff'));
alter table public.profiles add column if not exists title text;

-- ---------- permissions ----------
create table if not exists public.staff_permissions (
  user_id    uuid not null references public.profiles on delete cascade,
  module     text not null,
  level      text not null check (level in ('view', 'edit')),
  granted_by uuid references public.profiles,
  granted_at timestamptz not null default now(),
  primary key (user_id, module)
);
alter table public.staff_permissions enable row level security;
drop policy if exists sp_admin on public.staff_permissions;
create policy sp_admin on public.staff_permissions for all
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists sp_self_select on public.staff_permissions;
create policy sp_self_select on public.staff_permissions for select
  using (user_id = auth.uid());
grant select, insert, update, delete on public.staff_permissions to authenticated;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff') $$;

create or replace function public.can_view(m text)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_admin() or exists (
         select 1 from public.staff_permissions where user_id = auth.uid() and module = m) $$;

create or replace function public.can_edit(m text)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_admin() or exists (
         select 1 from public.staff_permissions where user_id = auth.uid() and module = m and level = 'edit') $$;

-- ---------- staff policies on every module table ----------
-- staff_<table>_view: select when the module is viewable
-- staff_<table>_edit: all operations when the module is editable
do $$
declare
  t record;
begin
  for t in select * from (values
    ('students',            'students'),
    ('enrollments',         'students'),
    ('guardians',           'students'),
    ('emergency_contacts',  'students'),
    ('document_references', 'students'),
    ('attendance',          'students'),
    ('medical_info',        'health'),
    ('media_consent',       'health'),
    ('applicants',          'admissions'),
    ('parent_students',     'parents'),
    ('portal_events',       'parents'),
    ('teachers',            'teachers'),
    ('teacher_grades',      'teachers'),
    ('fee_plans',           'fees'),
    ('payments',            'fees'),
    ('quran_progress',      'academics'),
    ('academic_progress',   'academics'),
    ('assignments',         'academics'),
    ('class_updates',       'academics'),
    ('calendar_events',     'calendar'),
    ('announcements',       'announcements'),
    ('feedback',            'feedback'),
    ('admin_tasks',         'tasks'),
    ('school_years',        'settings'),
    ('grades',              'settings'),
    ('document_types',      'settings')
  ) as v(tbl, module)
  loop
    execute format('drop policy if exists staff_%s_view on public.%I', t.tbl, t.tbl);
    execute format('create policy staff_%s_view on public.%I for select using (public.can_view(%L))', t.tbl, t.tbl, t.module);
    execute format('drop policy if exists staff_%s_edit on public.%I', t.tbl, t.tbl);
    execute format('create policy staff_%s_edit on public.%I for all using (public.can_edit(%L)) with check (public.can_edit(%L))', t.tbl, t.tbl, t.module, t.module);
  end loop;
end $$;

-- read-only companions
drop policy if exists staff_event_rsvps_view on public.event_rsvps;
create policy staff_event_rsvps_view on public.event_rsvps for select using (public.can_view('calendar'));
drop policy if exists staff_announcement_acks_view on public.announcement_acks;
create policy staff_announcement_acks_view on public.announcement_acks for select using (public.can_view('announcements'));

-- parent profiles: staff may read them with the parents module and update
-- them with edit, but can never change a role (with check pins role = parent)
drop policy if exists staff_profiles_view on public.profiles;
create policy staff_profiles_view on public.profiles for select
  using (role = 'parent' and public.can_view('parents'));
drop policy if exists staff_profiles_edit on public.profiles;
create policy staff_profiles_edit on public.profiles for update
  using (role = 'parent' and public.can_edit('parents'))
  with check (role = 'parent');

-- ---------- storage ----------
drop policy if exists "student docs staff read" on storage.objects;
create policy "student docs staff read" on storage.objects for select to authenticated
  using (bucket_id = 'student-documents' and public.can_view('students'));
drop policy if exists "student docs staff insert" on storage.objects;
create policy "student docs staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'student-documents' and public.can_edit('students'));
drop policy if exists "student docs staff update" on storage.objects;
create policy "student docs staff update" on storage.objects for update to authenticated
  using (bucket_id = 'student-documents' and public.can_edit('students'));
drop policy if exists "student docs staff delete" on storage.objects;
create policy "student docs staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'student-documents' and public.can_edit('students'));
drop policy if exists task_docs_staff_read on storage.objects;
create policy task_docs_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'task-docs' and public.can_view('tasks'));

-- ---------- functions that were admin-only ----------
create or replace function public.admin_parent_logins()
returns table (user_id uuid, email text, last_sign_in_at timestamptz)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, u.last_sign_in_at
  from auth.users u
  where public.can_view('parents');
$$;

create or replace function public.admin_parent_activity()
returns table (user_id uuid, full_name text, events_count bigint,
               days_active bigint, last_event_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.full_name,
         count(e.id) as events_count,
         count(distinct (e.occurred_at at time zone 'America/Los_Angeles')::date) as days_active,
         max(e.occurred_at) as last_event_at
  from public.profiles p
  left join public.portal_events e on e.user_id = p.id
  where public.can_view('parents') and p.role = 'parent'
  group by p.id, p.full_name;
$$;

-- accept_applicant: same body as phase 14, guard widened to admissions editors
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

-- ---------- audit: every staff write is logged ----------
-- (payments, medical_info and media_consent already have triggers; these
-- cover the other module tables — admin writes are logged too, which is fine)
create or replace function public.row_audit_generic()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  rid := coalesce((to_jsonb(coalesce(new, old)) ->> 'id'), (to_jsonb(coalesce(new, old)) ->> 'student_id'));
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action, entity, entity_id, new_value)
    values (auth.uid(), 'insert_' || tg_table_name, tg_table_name, rid, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), 'update_' || tg_table_name, tg_table_name, rid, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (actor, action, entity, entity_id, old_value)
    values (auth.uid(), 'delete_' || tg_table_name, tg_table_name, rid, to_jsonb(old));
    return old;
  end if;
end; $$;
do $$
declare t text;
begin
  foreach t in array array['students','enrollments','guardians','emergency_contacts','applicants',
    'teachers','fee_plans','calendar_events','announcements','staff_permissions']
  loop
    execute format('drop trigger if exists %s_audit_generic on public.%I', t, t);
    execute format('create trigger %s_audit_generic after insert or update or delete on public.%I for each row execute function public.row_audit_generic()', t, t);
  end loop;
end $$;
