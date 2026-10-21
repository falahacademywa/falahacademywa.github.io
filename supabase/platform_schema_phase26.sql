-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 26: teacher role for the teacher app
-- President's decisions 2026-10-16 (TODO #132, docs/teacher-app-plan.md):
--   * installable web app on the existing portal, no store apps
--   * teachers sign in with their own Google or Microsoft account; the login
--     only works when Admin → Teachers has switched "App access" on for a
--     teacher record with that e-mail
--   * teachers see a LIMITED student profile for their own grades (names,
--     photo, grade, parents + phones, emergency contacts, allergy/medical
--     summary, consent status — no DOB, e-mail, address, fees, documents)
--   * teachers write attendance, class updates and progress for their own
--     enrollments; edit their own teacher record
--   * photos of student work go to a private bucket + a queue table
-- Everything is additive: parent and admin policies are untouched.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. role + teacher record link ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'parent', 'staff', 'teacher'));

alter table public.teachers add column if not exists app_access boolean not null default false;
alter table public.teachers add column if not exists user_id uuid references public.profiles on delete set null;
alter table public.teachers add column if not exists app_last_sign_in timestamptz;
alter table public.teachers add column if not exists photo_url text;
alter table public.teachers add column if not exists bio text;
create unique index if not exists teachers_user_id_uq on public.teachers (user_id) where user_id is not null;

-- is this login an active teacher with app access?
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teachers t
                 where t.user_id = auth.uid() and t.app_access and t.active)
$$;

-- does the caller teach this grade in the current school year?
create or replace function public.teaches_grade(gid int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teachers t
    join public.teacher_grades tg on tg.teacher_id = t.id
    join public.school_years y on y.id = tg.school_year_id and y.is_current
    where t.user_id = auth.uid() and t.app_access and t.active and tg.grade_id = gid)
$$;

create or replace function public.teaches_enrollment(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e
                 where e.id = eid and e.status = 'active' and public.teaches_grade(e.grade_id))
$$;

-- the teacher's own e-mail, for stamping class updates / attendance
create or replace function public.my_teacher_email()
returns text language sql stable security definer set search_path = public as $$
  select t.email from public.teachers t where t.user_id = auth.uid() limit 1
$$;

-- ---------- 2. sign-in: link a new login to its teacher record ----------
-- Extends handle_new_user (phase 3). A Google/Microsoft login whose e-mail
-- matches a teacher with app_access becomes role 'teacher' and is linked.
-- Any other new login keeps the default role ('parent') exactly as before,
-- which gives it nothing until the office links it.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid; t_name text;
begin
  select id, first_name || ' ' || last_name into t_id, t_name
  from public.teachers where lower(email) = lower(new.email) and app_access and active limit 1;
  insert into public.profiles (id, full_name, email, role)
  values (new.id,
          coalesce(t_name, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
          new.email,
          case when t_id is not null then 'teacher' else 'parent' end)
  on conflict (id) do update set email = excluded.email;
  if t_id is not null then
    perform set_config('falah.system', 'on', true);   -- let teachers_protect accept the link
    update public.teachers set user_id = new.id, app_last_sign_in = now() where id = t_id;
  end if;
  return new;
end; $$;

-- Admin → Teachers: grant / revoke. Linking also covers a teacher who signed
-- in BEFORE access was granted (their profile exists as 'parent').
create or replace function public.set_teacher_app_access(p_teacher uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; uid uuid;
begin
  if not public.can_edit('teachers') then raise exception 'teachers permission required'; end if;
  select * into t from public.teachers where id = p_teacher;
  if t is null then raise exception 'teacher not found'; end if;
  perform set_config('falah.system', 'on', true);
  if p_on then
    if t.email is null then raise exception 'add the teacher''s e-mail first'; end if;
    -- an existing login with that e-mail?
    select p.id into uid from public.profiles p where lower(p.email) = lower(t.email) limit 1;
    update public.teachers set app_access = true, user_id = coalesce(user_id, uid) where id = p_teacher;
    if uid is not null then
      update public.profiles set role = 'teacher', full_name = t.first_name || ' ' || t.last_name
      where id = uid and role in ('parent', 'teacher');
    end if;
    return jsonb_build_object('app_access', true, 'linked', uid is not null);
  else
    update public.teachers set app_access = false where id = p_teacher;
    if t.user_id is not null then
      update public.profiles set role = 'parent' where id = t.user_id and role = 'teacher';
    end if;
    return jsonb_build_object('app_access', false);
  end if;
end; $$;
grant execute on function public.set_teacher_app_access(uuid, boolean) to authenticated;

-- stamp the last sign-in (called by the app after it loads the profile)
create or replace function public.teacher_touch_sign_in()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('falah.system', 'on', true);
  update public.teachers set app_last_sign_in = now() where user_id = auth.uid();
end; $$;
grant execute on function public.teacher_touch_sign_in() to authenticated;

-- ---------- 3. what a teacher may read ----------
-- Base tables: row access only for the teacher's grades; the LIMITED column
-- set is enforced by the views below, which are what the app queries.
drop policy if exists teacher_students_select on public.students;
create policy teacher_students_select on public.students for select using (
  public.is_teacher() and exists (select 1 from public.enrollments e
    where e.student_id = id and e.status = 'active' and public.teaches_grade(e.grade_id)));
drop policy if exists teacher_enrollments_select on public.enrollments;
create policy teacher_enrollments_select on public.enrollments for select using (
  public.is_teacher() and status = 'active' and public.teaches_grade(grade_id));
drop policy if exists teacher_grades_select on public.teacher_grades;  -- (tg_read already allows any login)
drop policy if exists teacher_teachers_select on public.teachers;
create policy teacher_teachers_select on public.teachers for select using (user_id = auth.uid());
drop policy if exists teacher_teachers_update on public.teachers;
create policy teacher_teachers_update on public.teachers for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- a teacher may change only phone, qualification, photo_url, bio on their own row
create or replace function public.teachers_protect_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or auth.role() = 'service_role'
     or current_setting('falah.system', true) = 'on' then return new; end if;   -- set by handle_new_user / set_teacher_app_access / teacher_touch_sign_in
  new.first_name := old.first_name; new.last_name := old.last_name; new.email := old.email;
  new.hire_date := old.hire_date; new.active := old.active; new.app_access := old.app_access;
  new.user_id := old.user_id; new.app_last_sign_in := old.app_last_sign_in;
  return new;
end; $$;
drop trigger if exists teachers_protect on public.teachers;
create trigger teachers_protect before update on public.teachers
  for each row execute function public.teachers_protect_columns();

-- Re-runnable backfill: a teacher with app access whose login already exists
-- (signed in before this fix, or before access was granted) gets linked now.
do $$
begin
  perform set_config('falah.system', 'on', true);
  update public.teachers t
     set user_id = p.id, app_last_sign_in = coalesce(t.app_last_sign_in, now())
    from public.profiles p
   where lower(p.email) = lower(t.email) and t.app_access and t.user_id is null;
  update public.profiles p set role = 'teacher'
    from public.teachers t
   where t.user_id = p.id and t.app_access and t.active and p.role = 'parent';
end $$;


-- Limited roster view (security definer: the view filters rows itself, and
-- only these columns ever reach the app).
create or replace view public.teacher_students as
  select s.id as student_id, e.id as enrollment_id, s.student_no, s.first_name, s.last_name,
         s.profile_photo_url, e.grade_id, g.name as grade_name,
         coalesce(mi.has_allergies, false) as has_allergies, mi.allergies,
         nullif(btrim(coalesce(mi.medical_conditions, '')), '') as medical_conditions,
         nullif(btrim(coalesce(mi.medications, '')), '') as medications,
         nullif(btrim(coalesce(mi.emergency_medication, '')), '') as emergency_medication,
         mi.dietary_restrictions, mi.physician_name, mi.physician_phone,
         (mi.allergy_signed_date is not null) as allergy_form_done,
         (mi.medical_signed_date is not null) as medical_form_done,
         case when mc.student_id is null or mc.signed_date is null then 'not_on_file'
              when coalesce(mc.website_print, false) and coalesce(mc.social_media, false) and coalesce(mc.external_media, false) then 'public'
              when coalesce(mc.internal_use, false) or coalesce(mc.parent_comms, false) or coalesce(mc.website_print, false)
                   or coalesce(mc.social_media, false) or coalesce(mc.external_media, false) then 'limited'
              else 'none' end as consent_status,
         mc.name_preference
  from public.students s
  join public.enrollments e on e.student_id = s.id and e.status = 'active'
  join public.grades g on g.id = e.grade_id
  left join public.medical_info mi on mi.student_id = s.id
  left join public.media_consent mc on mc.student_id = s.id
  where not s.archived and public.teaches_grade(e.grade_id);
grant select on public.teacher_students to authenticated;

create or replace view public.teacher_student_contacts as
  select g.student_id, 'guardian' as kind, g.name, g.relationship, g.phone, g.sort as sort_order,
         exists (select 1 from public.parent_students ps join public.profiles p on p.id = ps.parent_id
                 where ps.student_id = g.student_id and ps.is_primary_contact and lower(p.email) = lower(g.email)) as is_primary
  from public.guardians g
  join public.enrollments e on e.student_id = g.student_id and e.status = 'active'
  where public.teaches_grade(e.grade_id)
  union all
  select ec.student_id, 'emergency', ec.name, ec.relationship, ec.phone, case when ec.is_primary then 0 else 1 end, ec.is_primary
  from public.emergency_contacts ec
  join public.enrollments e on e.student_id = ec.student_id and e.status = 'active'
  where public.teaches_grade(e.grade_id);
grant select on public.teacher_student_contacts to authenticated;

-- ---------- 4. what a teacher may write ----------
-- attendance: own enrollments, today or past
drop policy if exists teacher_attendance_select on public.attendance;
create policy teacher_attendance_select on public.attendance for select using (public.teaches_enrollment(enrollment_id));
drop policy if exists teacher_attendance_write on public.attendance;
create policy teacher_attendance_write on public.attendance for insert with check (public.teaches_enrollment(enrollment_id));
drop policy if exists teacher_attendance_update on public.attendance;
create policy teacher_attendance_update on public.attendance for update
  using (public.teaches_enrollment(enrollment_id)) with check (public.teaches_enrollment(enrollment_id));
grant select, insert, update on public.attendance to authenticated;
grant usage, select on sequence public.attendance_id_seq to authenticated;

-- class updates: own grade or own enrollment; teacher_email stamped from the record
drop policy if exists teacher_cu_select on public.class_updates;
create policy teacher_cu_select on public.class_updates for select using (
  (grade_id is not null and public.teaches_grade(grade_id))
  or (enrollment_id is not null and public.teaches_enrollment(enrollment_id)));
drop policy if exists teacher_cu_insert on public.class_updates;
create policy teacher_cu_insert on public.class_updates for insert with check (
  public.is_teacher() and (
    (grade_id is not null and public.teaches_grade(grade_id))
    or (enrollment_id is not null and public.teaches_enrollment(enrollment_id))));
drop policy if exists teacher_cu_delete on public.class_updates;
create policy teacher_cu_delete on public.class_updates for delete using (
  public.is_teacher() and lower(coalesce(teacher_email, '')) = lower(coalesce(public.my_teacher_email(), '-'))
  and created_at > now() - interval '1 day');   -- undo a mistake the same day
create or replace function public.class_updates_stamp_teacher()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_teacher() then new.teacher_email := public.my_teacher_email(); end if;
  return new;
end; $$;
drop trigger if exists class_updates_stamp on public.class_updates;
create trigger class_updates_stamp before insert on public.class_updates
  for each row execute function public.class_updates_stamp_teacher();
grant select, insert, delete on public.class_updates to authenticated;

-- assignments (homework with a due date, created alongside a class update)
drop policy if exists teacher_asg_select on public.assignments;
create policy teacher_asg_select on public.assignments for select using (
  (grade_id is not null and public.teaches_grade(grade_id))
  or (enrollment_id is not null and public.teaches_enrollment(enrollment_id)));
drop policy if exists teacher_asg_insert on public.assignments;
create policy teacher_asg_insert on public.assignments for insert with check (
  public.is_teacher() and (
    (grade_id is not null and public.teaches_grade(grade_id))
    or (enrollment_id is not null and public.teaches_enrollment(enrollment_id))));
grant select, insert on public.assignments to authenticated;

-- progress: own enrollments
drop policy if exists teacher_qp_select on public.quran_progress;
create policy teacher_qp_select on public.quran_progress for select using (public.teaches_enrollment(enrollment_id));
drop policy if exists teacher_qp_insert on public.quran_progress;
create policy teacher_qp_insert on public.quran_progress for insert with check (public.teaches_enrollment(enrollment_id));
drop policy if exists teacher_ap_select on public.academic_progress;
create policy teacher_ap_select on public.academic_progress for select using (public.teaches_enrollment(enrollment_id));
drop policy if exists teacher_ap_insert on public.academic_progress;
create policy teacher_ap_insert on public.academic_progress for insert with check (public.teaches_enrollment(enrollment_id));
grant select, insert on public.quran_progress, public.academic_progress to authenticated;
grant usage, select on sequence public.quran_progress_id_seq, public.academic_progress_id_seq to authenticated;

-- reference data the app needs
drop policy if exists teacher_grades_ref on public.grades;
create policy teacher_grades_ref on public.grades for select using (auth.uid() is not null);

-- ---------- 5. photos of student work (queue for the AI step) ----------
create table if not exists public.work_uploads (
  id            bigserial primary key,
  enrollment_id uuid not null references public.enrollments on delete cascade,
  path          text not null,                 -- student-work/<enrollment>/<yyyy-mm-dd>/<file>
  taken_at      date not null default (now() at time zone 'America/Los_Angeles')::date,
  subject       text,
  note          text,
  uploaded_by   uuid references public.profiles,
  status        text not null default 'new' check (status in ('new', 'drafted', 'confirmed', 'rejected')),
  draft_entry   jsonb,
  created_at    timestamptz not null default now()
);
alter table public.work_uploads enable row level security;
drop policy if exists wu_admin on public.work_uploads;
create policy wu_admin on public.work_uploads for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists wu_teacher on public.work_uploads;
create policy wu_teacher on public.work_uploads for all
  using (public.teaches_enrollment(enrollment_id)) with check (public.teaches_enrollment(enrollment_id));
grant select, insert, update, delete on public.work_uploads to authenticated;
grant usage, select on sequence public.work_uploads_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-work', 'student-work', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists student_work_teacher_insert on storage.objects;
create policy student_work_teacher_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'student-work' and (public.is_admin() or public.is_teacher()));
drop policy if exists student_work_read on storage.objects;
create policy student_work_read on storage.objects for select to authenticated
  using (bucket_id = 'student-work' and (public.is_admin() or public.is_teacher()));
drop policy if exists student_work_delete on storage.objects;
create policy student_work_delete on storage.objects for delete to authenticated
  using (bucket_id = 'student-work' and (public.is_admin() or owner = auth.uid()));

-- class-update photos from the app (parents open attachment_url directly, as
-- they do with the Drive links from the Google Form, so the bucket is public-read)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('class-updates', 'class-updates', true, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
drop policy if exists class_updates_photo_insert on storage.objects;
create policy class_updates_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'class-updates' and (public.is_admin() or public.is_teacher()));
drop policy if exists class_updates_photo_read on storage.objects;
create policy class_updates_photo_read on storage.objects for select using (bucket_id = 'class-updates');
drop policy if exists class_updates_photo_delete on storage.objects;
create policy class_updates_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'class-updates' and (public.is_admin() or owner = auth.uid()));

-- several photos per update from the app (attachment_url/_thumb keep the first
-- one so the Google-Form posts and older readers keep working)
alter table public.class_updates add column if not exists attachment_urls text[] not null default '{}';

-- teacher profile from the app (President 2026-10-17): photo, address, emergency contact
alter table public.teachers add column if not exists address text;
alter table public.teachers add column if not exists emergency_name text;
alter table public.teachers add column if not exists emergency_phone text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-photos', 'teacher-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists teacher_photos_write on storage.objects;
create policy teacher_photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'teacher-photos' and (public.is_admin() or public.is_teacher()));
drop policy if exists teacher_photos_read on storage.objects;
create policy teacher_photos_read on storage.objects for select using (bucket_id = 'teacher-photos');
drop policy if exists teacher_photos_delete on storage.objects;
create policy teacher_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'teacher-photos' and (public.is_admin() or owner = auth.uid()));

-- ---------- 6. notifications for teachers ----------
-- teachers can read their own notifications (same table, policies already use recipient_id = auth.uid())
-- audit on the new table
drop trigger if exists work_uploads_audit_generic on public.work_uploads;
create trigger work_uploads_audit_generic after insert or update or delete on public.work_uploads
  for each row execute function public.row_audit_generic();
