-- Phase 39 (2026-11-05, security review follow-ups). Run in dev AND prod, after phase 38.
-- Safe to run more than once. Numbers refer to the review list given to the President.
--
--   3  Child photos private: buckets student-photos and class-updates are no longer public; the
--      portal shows them through short-lived signed links. Who may open them:
--        student-photos/<student id>/...  admin, staff with students view, the child's parents,
--                                         teachers of the child's grade
--        class-updates/<date>/...         whoever can read the class update that holds the file
--                                         (class_updates RLS), and the uploader
--      Uploads to student-photos: parents for their own child, admin, staff with students edit.
--   5  Suspended logins are blocked in Supabase Auth too (banned), not only hidden in the portal.
--   6  Any signed-in user could read every teacher record (home address, emergency contact):
--      policy teachers_read removed. Teachers still read their own row; admin/staff unchanged.
--   7  Social posts: only the President/admins may turn a draft into a closure post (T6); the card
--      must be one of our own drawn cards (social/cards/...).
--   8  E-mail text is HTML-escaped in email_now (visitor-typed names could carry links/HTML), and
--      the two public website forms are rate-limited.
--   9  Social poster: a post stuck in "posting" (crash/time-out) can be claimed again after 10 min.
--  10  Parent-meeting booking: parent name no longer returned; attempts are throttled per class;
--      a booking can only be moved or cancelled with the phone number that booked it; a bad time
--      value no longer raises an error.
--  11  Teachers see Red Comet workbook photos of their own grades only.
--  13  Deleting a student/enrollment/fee plan no longer deletes payment history (restrict).
--  14  Staff with students edit can now actually suspend parent logins through
--      set_student_status (the profile guard silently reverted it before).

-- ============================================================ 3. private child photos
update storage.buckets set public = false where id in ('student-photos', 'class-updates');

create or replace function public.student_photo_visible(folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.can_view('students')
      or exists (select 1 from public.parent_students ps where ps.parent_id = auth.uid() and ps.student_id::text = folder)
      or exists (select 1 from public.enrollments e
                  where e.student_id::text = folder and e.status = 'active' and public.teaches_grade(e.grade_id))
$$;
revoke all on function public.student_photo_visible(text) from public, anon;
grant execute on function public.student_photo_visible(text) to authenticated, service_role;

create or replace function public.student_photo_uploadable(folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.can_edit('students')
      or exists (select 1 from public.parent_students ps where ps.parent_id = auth.uid() and ps.student_id::text = folder)
$$;
revoke all on function public.student_photo_uploadable(text) from public, anon;
grant execute on function public.student_photo_uploadable(text) to authenticated, service_role;

drop policy if exists "student photos read" on storage.objects;
drop policy if exists student_photos_read on storage.objects;
create policy student_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'student-photos' and public.student_photo_visible((storage.foldername(name))[1]));
drop policy if exists "student photos upload" on storage.objects;
drop policy if exists student_photos_upload on storage.objects;
create policy student_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'student-photos' and public.student_photo_uploadable((storage.foldername(name))[1]));

-- class-update files: visible when the user can read a class update that references the file
-- (the subquery runs with the user's own RLS on class_updates), or to the uploader
drop policy if exists class_updates_photo_read on storage.objects;
create policy class_updates_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'class-updates' and (
    public.is_admin() or owner = auth.uid()
    or exists (select 1 from public.class_updates cu
                where position('/class-updates/' || storage.objects.name in
                               coalesce(cu.attachment_url, '') || ' ' || array_to_string(cu.attachment_urls, ' ')) > 0)));

-- ============================================================ 5. suspension also blocks sign-in
create or replace function public.trg_profile_suspend_auth()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.suspended is distinct from old.suspended and new.role <> 'admin' then
    begin
      update auth.users set banned_until = case when new.suspended then 'infinity'::timestamptz else null end
       where id = new.id;
    exception when others then
      raise warning 'could not update the auth ban for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end; $$;
drop trigger if exists profile_suspend_auth on public.profiles;
create trigger profile_suspend_auth after update of suspended on public.profiles
  for each row execute function public.trg_profile_suspend_auth();
-- logins suspended before this phase
update auth.users u set banned_until = 'infinity'::timestamptz
  from public.profiles p where p.id = u.id and p.suspended and p.role <> 'admin' and u.banned_until is null;

-- ============================================================ 14. staff may suspend parents via set_student_status
create or replace function public.trg_protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.email := old.email;
    -- staff with students edit may (un)suspend a parent login (set_student_status does this)
    if not (public.can_edit('students') and old.role = 'parent') then
      new.suspended := old.suspended;
    end if;
  end if;
  return new;
end; $$;

-- ============================================================ 6. teacher records
drop policy if exists teachers_read on public.teachers;

-- ============================================================ 7 + 9. social posts
alter table public.social_posts add column if not exists posting_at timestamptz;

create or replace function public.trg_social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then new.updated_at := now(); return new; end if;
  if tg_op = 'UPDATE' and old.status in ('posting', 'posted') then
    raise exception 'this post has already been sent; it can no longer be changed';
  end if;
  if new.status in ('posting', 'posted') then raise exception 'only the poster can mark a post as sent'; end if;
  if new.status = 'scheduled' and not public.is_admin() then raise exception 'only the President or an admin can schedule a post'; end if;
  if not public.is_admin() then
    -- staff may post only closure posts (T6): they cannot turn another draft into one
    if tg_op = 'UPDATE' and new.template_key is distinct from old.template_key then
      raise exception 'only the President or an admin can change the template of a post';
    end if;
  end if;
  -- the card must be one of our own drawn cards in the social bucket
  if new.card_url is not null and new.card_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/social/cards/' then
    raise exception 'the card must be drawn in the portal';
  end if;
  if new.image_url is not null and new.image_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/social/' then
    raise exception 'images must be uploaded through the portal';
  end if;
  new.fb_post_id := case when tg_op = 'UPDATE' then old.fb_post_id end;
  new.ig_media_id := case when tg_op = 'UPDATE' then old.ig_media_id end;
  new.ig_permalink := case when tg_op = 'UPDATE' then old.ig_permalink end;
  new.posted_at := case when tg_op = 'UPDATE' then old.posted_at end;
  new.posted_by := case when tg_op = 'UPDATE' then old.posted_by end;
  new.posting_at := case when tg_op = 'UPDATE' then old.posting_at end;
  new.updated_at := now();
  return new;
end; $$;

create or replace function public.social_claim(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.social_posts set status = 'posting', posting_at = now(), error = null
   where id = p_id
     and (status not in ('posting', 'posted')
          or (status = 'posting' and coalesce(posting_at, updated_at) < now() - interval '10 minutes'));
  return found;
end; $$;
revoke all on function public.social_claim(bigint) from public, anon, authenticated;
grant execute on function public.social_claim(bigint) to service_role;

-- ============================================================ 8. e-mail escaping + public form limits
create or replace function public.html_escape(t text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

create or replace function public.email_now(p_to text, p_name text, p_subject text, p_message text)
returns boolean language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p_to is null or p_to like '%test.local%' then return false; end if;
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'brevo_api_key' limit 1;
  exception when others then k := null;
  end;
  if k is null then return false; end if;
  perform net.http_post(
    url     := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', k, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body    := jsonb_build_object(
      'sender', jsonb_build_object('name', 'Falah Academy', 'email', 'falahacademywa@gmail.com'),
      'to', jsonb_build_array(jsonb_build_object('email', p_to, 'name', left(coalesce(p_name, 'Falah Academy'), 120))),
      'subject', 'Falah Academy: ' || left(regexp_replace(coalesce(p_subject, ''), '[\r\n]+', ' ', 'g'), 150),
      'htmlContent', '<p>Assalamu Alaikum ' || public.html_escape(p_name) || ',</p><p>' || public.html_escape(p_message) ||
        '</p><p>Details: <a href="https://falahacademywa.org/platform/">Family Portal</a></p><p>— Falah Academy</p>'));
  return true;
exception when others then
  return false;
end; $$;
revoke execute on function public.email_now(text, text, text, text) from public, anon, authenticated;
grant execute on function public.email_now(text, text, text, text) to service_role;

-- website forms (anon): at most 20 per hour in total and 3 per e-mail address per day
create or replace function public.trg_public_form_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int; em text := lower(btrim(coalesce(to_jsonb(new) ->> 'email', to_jsonb(new) ->> 'parent_email', '')));
begin
  if coalesce(auth.role(), 'anon') <> 'anon' then return new; end if;
  execute format('select count(*) from public.%I where created_at > now() - interval ''1 hour''', tg_table_name) into n;
  if n >= 20 then raise exception 'We are receiving many forms right now. Please try again in an hour or e-mail falahacademywa@gmail.com.'; end if;
  if em <> '' then
    execute format('select count(*) from public.%I where created_at > now() - interval ''1 day''
                     and lower(btrim(coalesce(to_jsonb(%I) ->> ''email'', to_jsonb(%I) ->> ''parent_email'', ''''))) = $1',
                   tg_table_name, tg_table_name, tg_table_name) into n using em;
    if n >= 3 then raise exception 'We already have your form from today. Please e-mail falahacademywa@gmail.com if something needs changing.'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists public_form_limit on public.volunteer_applications;
create trigger public_form_limit before insert on public.volunteer_applications
  for each row execute function public.trg_public_form_limit();
drop trigger if exists public_form_limit on public.applicants;
create trigger public_form_limit before insert on public.applicants
  for each row execute function public.trg_public_form_limit();

-- ============================================================ 10. parent-meeting booking
create table if not exists public.ptm_attempts (
  id bigserial primary key, class_id int, ok boolean not null, at timestamptz not null default now()
);
alter table public.ptm_attempts enable row level security;
drop policy if exists ptm_attempts_admin on public.ptm_attempts;
create policy ptm_attempts_admin on public.ptm_attempts for select using (public.is_admin());
grant select on public.ptm_attempts to authenticated;
grant all on public.ptm_attempts to service_role;
create index if not exists ptm_attempts_recent on public.ptm_attempts (class_id, at) where not ok;

-- too many failed name+phone matches for this class in the last 15 minutes?
create or replace function public.ptm_throttled(cid int)
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) >= 25 from public.ptm_attempts where class_id = cid and not ok and at > now() - interval '15 minutes'
$$;
revoke all on function public.ptm_throttled(int) from public, anon, authenticated;

drop function if exists public.ptm_family(text, text, text);
create function public.ptm_family(p_token text, p_child text, p_phone text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cid int; fam int; ph text := public.ptm_phone(p_phone); first text := lower(split_part(btrim(coalesce(p_child, '')), ' ', 1));
begin
  if length(ph) < 10 or first = '' then return null; end if;
  cid := public.ptm_class_of(p_token);
  if cid is null then return null; end if;
  if public.ptm_throttled(cid) then return jsonb_build_object('error', 'Too many tries. Please wait 15 minutes or contact the school office.'); end if;
  select ps.family_no into fam
    from public.ptm_students ps join public.students s on s.id = ps.student_id
   where ps.class_id = cid and ps.invited and lower(btrim(s.first_name)) = first
     and exists (select 1 from public.ptm_students f join public.guardians g on g.student_id = f.student_id
                  where f.class_id = cid and f.family_no = ps.family_no and public.ptm_phone(g.phone) = ph)
   limit 1;
  insert into public.ptm_attempts (class_id, ok) values (cid, fam is not null);
  if fam is null then return null; end if;
  return jsonb_build_object(
    'children', (select jsonb_agg(s.first_name order by s.first_name) from public.ptm_students ps
                   join public.students s on s.id = ps.student_id
                  where ps.class_id = cid and ps.family_no = fam and ps.invited),
    'slot', (select public.ptm_hm(b.slot) from public.ptm_bookings b where b.class_id = cid and b.family_no = fam),
    'parent_name', null);
end; $$;
grant execute on function public.ptm_family(text, text, text) to anon, authenticated;

create or replace function public.ptm_book(p_token text, p_child text, p_phone text, p_slot text, p_parent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; e record; fam int; t time; ph text := public.ptm_phone(p_phone);
        first text := lower(split_part(btrim(coalesce(p_child, '')), ' ', 1)); had time; had_phone text; kids text;
begin
  select cl.* into c from public.ptm_classes cl where cl.id = public.ptm_class_of(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into e from public.ptm_events where id = c.event_id;
  if not e.active or (e.book_until is not null and now() >= e.book_until) then
    return jsonb_build_object('ok', false, 'error', 'Booking is closed. Please contact the school office.');
  end if;
  if public.ptm_throttled(c.id) then
    return jsonb_build_object('ok', false, 'error', 'Too many tries. Please wait 15 minutes or contact the school office.');
  end if;
  select ps.family_no into fam
    from public.ptm_students ps join public.students s on s.id = ps.student_id
   where ps.class_id = c.id and ps.invited and lower(btrim(s.first_name)) = first and length(ph) = 10
     and exists (select 1 from public.ptm_students f join public.guardians g on g.student_id = f.student_id
                  where f.class_id = c.id and f.family_no = ps.family_no and public.ptm_phone(g.phone) = ph)
   limit 1;
  insert into public.ptm_attempts (class_id, ok) values (c.id, fam is not null);
  if fam is null then
    return jsonb_build_object('ok', false, 'error', 'We could not match that name and phone number. Please use the number the school has on file, or contact the office.');
  end if;
  select string_agg(s.first_name, ' & ' order by s.first_name) into kids
    from public.ptm_students ps join public.students s on s.id = ps.student_id
   where ps.class_id = c.id and ps.family_no = fam and ps.invited;
  select slot, phone into had, had_phone from public.ptm_bookings where class_id = c.id and family_no = fam;
  -- an existing booking can be moved or cancelled only with the phone number that made it
  if had is not null and had_phone is not null and public.ptm_phone(had_phone) <> ph then
    return jsonb_build_object('ok', false, 'error', 'This meeting was booked with a different phone number. Please use that number, or contact the school office to change it.');
  end if;

  if p_slot is null then
    delete from public.ptm_bookings where class_id = c.id and family_no = fam;
    if had is not null then
      perform public.ptm_note_admins('Parent meeting cancelled',
        c.name || ': the ' || public.ptm_ampm(had) || ' meeting for ' || kids || ' was cancelled by the parent.');
    end if;
    return jsonb_build_object('ok', true, 'slot', null);
  end if;

  if p_slot !~ '^\s*[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?\s*$' then
    return jsonb_build_object('ok', false, 'error', 'That time is not offered.');
  end if;
  begin
    t := p_slot::time;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'That time is not offered.');
  end;
  if not (t = any (e.slots)) or (t = any (c.closed_slots) and had is distinct from t) then
    return jsonb_build_object('ok', false, 'error', 'That time is not offered.');
  end if;
  perform 1 from public.ptm_classes where id = c.id for update;     -- one booking at a time per class
  if (select count(*) from public.ptm_bookings b where b.class_id = c.id and b.slot = t and b.family_no <> fam) >= c.capacity then
    return jsonb_build_object('ok', false, 'error', 'Sorry, that time was just taken. Please choose another.');
  end if;
  insert into public.ptm_bookings (class_id, family_no, slot, parent_name, phone)
  values (c.id, fam, t, nullif(btrim(p_parent), ''), btrim(p_phone))
  on conflict (class_id, family_no) do update set slot = excluded.slot, parent_name = coalesce(excluded.parent_name, ptm_bookings.parent_name),
     phone = excluded.phone, booked_at = now();
  if had is distinct from t then
    perform public.ptm_note_admins('Parent meeting ' || case when had is null then 'booked' else 'moved' end,
      c.name || ': ' || kids || ' — ' || public.ptm_ampm(t) || ' on ' || to_char(e.meet_date, 'FMMon FMDD')
      || case when had is null then '' else ' (was ' || public.ptm_ampm(had) || ')' end || '.');
  end if;
  return jsonb_build_object('ok', true, 'slot', public.ptm_hm(t));
end; $$;
grant execute on function public.ptm_book(text, text, text, text, text) to anon, authenticated;

-- ============================================================ 11. workbook photos: own grades only
create or replace function public.teaches_enrollment_txt(t text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e where e.id::text = t and public.teaches_grade(e.grade_id))
$$;
revoke all on function public.teaches_enrollment_txt(text) from public, anon;
grant execute on function public.teaches_enrollment_txt(text) to authenticated, service_role;
drop policy if exists student_work_read on storage.objects;
create policy student_work_read on storage.objects for select to authenticated
  using (bucket_id = 'student-work' and (
    public.is_admin() or public.can_view('redcomet') or owner = auth.uid()
    or public.teaches_enrollment_txt((storage.foldername(name))[1])));

-- ============================================================ 13. payments survive deletes
do $$
declare con text;
begin
  select conname into con from pg_constraint
   where conrelid = 'public.payments'::regclass and contype = 'f' and confrelid = 'public.fee_plans'::regclass;
  if con is not null then
    execute format('alter table public.payments drop constraint %I', con);
  end if;
  alter table public.payments add constraint payments_fee_plan_id_fkey
    foreign key (fee_plan_id) references public.fee_plans (id) on delete restrict;
end $$;

select 'phase 39 ok' as result,
  (select string_agg(id || '=' || public, ', ' order by id) from storage.buckets where id in ('student-photos', 'class-updates')) as buckets,
  (select count(*) from pg_policies where tablename = 'teachers' and policyname = 'teachers_read') as teachers_read_left,
  (select confdeltype from pg_constraint where conname = 'payments_fee_plan_id_fkey') as payments_fk_on_delete;
