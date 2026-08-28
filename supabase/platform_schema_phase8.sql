-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 8: student photos (BR-088)
-- Parents upload a photo of their own child; admin approves before it
-- becomes the profile picture. Run in dev AND prod. Re-runnable.
-- ================================================================

alter table public.students add column if not exists photo_pending_url text;

-- Storage bucket (public read; unguessable UUID paths — same model as the
-- Drive links already used for class-update photos)
insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', true)
on conflict (id) do nothing;

drop policy if exists "student photos upload" on storage.objects;
create policy "student photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'student-photos');

drop policy if exists "student photos read" on storage.objects;
create policy "student photos read" on storage.objects for select
  using (bucket_id = 'student-photos');

-- Parents may request a photo ONLY for their own child; admin approves in
-- the portal (copies pending -> profile_photo_url or clears it).
create or replace function public.request_student_photo(sid uuid, url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_my_child(sid)) then
    raise exception 'not allowed';
  end if;
  update public.students set photo_pending_url = url where id = sid;
end; $$;
