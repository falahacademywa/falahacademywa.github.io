-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 11: family self-service + documents
-- 1. Parents may set the family's primary contact and fix guardian
--    phone numbers (other guardian columns stay office-managed).
-- 2. Parents may correct their children's names (nothing else).
-- 3. Required-documents checklist: admin-managed form list, per-child
--    submission tracking, private storage for the scanned forms that
--    parents can view/download for their own children only.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. Guardians: parent updates, column-protected ----------
drop policy if exists guard_parent_update on public.guardians;
create policy guard_parent_update on public.guardians for update
  using (public.is_my_child(student_id))
  with check (public.is_my_child(student_id));

-- Parents may change phone and sort (primary contact) only; names,
-- emails (account linkage!), and relationships stay office-managed.
create or replace function public.trg_protect_guardian_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.name := old.name;
    new.email := old.email;
    new.relationship := old.relationship;
    new.student_id := old.student_id;
  end if;
  return new;
end; $$;
drop trigger if exists protect_guardian_columns on public.guardians;
create trigger protect_guardian_columns before update on public.guardians
  for each row execute function public.trg_protect_guardian_columns();

-- ---------- 2. Students: parents may correct names only ----------
drop policy if exists students_parent_update on public.students;
create policy students_parent_update on public.students for update
  using (public.is_my_child(id))
  with check (public.is_my_child(id));

-- photo_pending_url stays writable because the phase-8 photo RPC runs
-- with the parent's auth context.
create or replace function public.trg_protect_student_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.date_of_birth := old.date_of_birth;
    new.gender := old.gender;
    new.archived := old.archived;
    new.notes := old.notes;
    new.profile_photo_url := old.profile_photo_url;
  end if;
  return new;
end; $$;
drop trigger if exists protect_student_columns on public.students;
create trigger protect_student_columns before update on public.students
  for each row execute function public.trg_protect_student_columns();

-- ---------- 3. Required documents ----------
create table if not exists public.document_types (
  id serial primary key,
  name text unique not null,
  sort int not null default 100,
  active boolean not null default true
);
alter table public.document_types enable row level security;

drop policy if exists doctypes_read on public.document_types;
create policy doctypes_read on public.document_types for select
  using (auth.uid() is not null);
drop policy if exists doctypes_admin on public.document_types;
create policy doctypes_admin on public.document_types for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.document_types (name, sort) values
  ('Birth Certificate', 1),
  ('Primary Contact Information', 2),
  ('Emergency Contact Information', 3),
  ('Medical/Allergies Form', 4),
  ('Photo, Video & Media Consent Form', 5)
on conflict (name) do nothing;

-- A submission may be a scanned file in private storage (storage_path),
-- an external link (file_url), or a paper record with no file at all.
alter table public.document_references add column if not exists storage_path text;
alter table public.document_references alter column file_url drop not null;

-- ---------- 4. Private storage for scanned forms ----------
-- NOT public: birth certificates etc. Parents read only their own
-- children's files (paths are '<student_id>/<uuid>-<filename>').
insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

drop policy if exists "student docs admin insert" on storage.objects;
create policy "student docs admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'student-documents' and public.is_admin());
drop policy if exists "student docs admin update" on storage.objects;
create policy "student docs admin update" on storage.objects for update to authenticated
  using (bucket_id = 'student-documents' and public.is_admin());
drop policy if exists "student docs admin delete" on storage.objects;
create policy "student docs admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'student-documents' and public.is_admin());
drop policy if exists "student docs read" on storage.objects;
create policy "student docs read" on storage.objects for select to authenticated
  using (bucket_id = 'student-documents'
    and (public.is_admin() or public.is_my_child(split_part(name, '/', 1)::uuid)));
