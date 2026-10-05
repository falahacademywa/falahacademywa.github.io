-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 22: volunteers + admin alerts for class updates
-- President's request 2026-10-05:
--   1. The public website gets a volunteer application page (volunteer.html).
--      Each submission lands in volunteer_applications (anon insert, like
--      applicants) and every admin gets an in-app alert plus an immediate
--      e-mail (email_now via Brevo; falls back to the daily dispatcher).
--      Admin -> Volunteers works the application: references, WATCH check,
--      registry check, orientation, agreement, approve/decline.
--   2. Admins are told when a teacher posts a class update (in-app at once;
--      the e-mail rides with the daily dispatcher so a busy day is one batch).
--   3. The activity calendar (Admin -> Activity) needs no new tables.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. volunteer applications ----------
create table if not exists public.volunteer_applications (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  preferred_name   text,
  email            text not null,
  phone            text,
  address          text,
  city             text,
  state            text default 'WA',
  zip              text,
  date_of_birth    date,
  under_18         boolean not null default false,
  guardian_name    text,
  guardian_phone   text,
  availability     jsonb not null default '{}'::jsonb,   -- {"mon":["am","pm"],"tue":[],...,"events":true}
  start_date       date,
  hours_per_week   text,
  interests        text[] not null default '{}',
  experience       text,
  languages        text,
  first_aid        boolean,
  prior_volunteering text,
  references_info  jsonb not null default '[]'::jsonb,   -- [{name, relationship, phone, email}, ...]
  disclosures      jsonb not null default '{}'::jsonb,   -- {convicted, abuse_finding, registry, explanation}
  consent          boolean not null default false,
  source           text not null default 'website',
  status           text not null default 'new'
                   check (status in ('new','contacted','screening','approved','active','declined','withdrawn')),
  checks           jsonb not null default '{}'::jsonb,   -- {ref1, ref2, watch, registry, orientation, agreement}: "YYYY-MM-DD"
  assigned_grade_id int references public.grades,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles
);
alter table public.volunteer_applications enable row level security;

-- the public website inserts with the publishable key; nothing else for anon
drop policy if exists va_public_insert on public.volunteer_applications;
create policy va_public_insert on public.volunteer_applications for insert to anon
  with check (status = 'new' and consent = true and source = 'website');
drop policy if exists va_admin on public.volunteer_applications;
create policy va_admin on public.volunteer_applications for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists staff_volunteer_applications_view on public.volunteer_applications;
create policy staff_volunteer_applications_view on public.volunteer_applications for select using (public.can_view('volunteers'));
drop policy if exists staff_volunteer_applications_edit on public.volunteer_applications;
create policy staff_volunteer_applications_edit on public.volunteer_applications for all
  using (public.can_edit('volunteers')) with check (public.can_edit('volunteers'));
grant insert on public.volunteer_applications to anon;
grant select, insert, update, delete on public.volunteer_applications to authenticated;

-- updated_at + audit (same helpers as phase 19)
create or replace function public.trg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists volunteer_applications_touch on public.volunteer_applications;
create trigger volunteer_applications_touch before update on public.volunteer_applications
  for each row execute function public.trg_touch_updated_at();
drop trigger if exists volunteer_applications_audit_generic on public.volunteer_applications;
create trigger volunteer_applications_audit_generic after insert or update or delete on public.volunteer_applications
  for each row execute function public.row_audit_generic();

-- new application -> every admin, e-mailed at once
create or replace function public.trg_volunteer_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare ints text;
begin
  ints := coalesce(array_to_string(new.interests, ', '), '');
  perform public.notify_admins(
    'New volunteer application: ' || new.full_name,
    new.full_name || ' applied to volunteer through the website' ||
      case when ints <> '' then ' (' || ints || ')' else '' end ||
      case when new.under_18 then ' — under 18, parent consent needed' else '' end ||
      '. Open Admin → Volunteers to call the references and start the background check.',
    'action', '/admin/volunteers', true);
  return new;
end; $$;
drop trigger if exists volunteer_applications_notify on public.volunteer_applications;
create trigger volunteer_applications_notify after insert on public.volunteer_applications
  for each row execute function public.trg_volunteer_notify();

-- ---------- 1b. résumé upload (PDF / Word, 5 MB) ----------
-- The website uploads the file straight into the private bucket before the
-- insert; the row keeps the path. Admins open it through a signed URL.
alter table public.volunteer_applications add column if not exists resume_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('volunteer-docs', 'volunteer-docs', false, 5242880,
        array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
drop policy if exists volunteer_docs_public_insert on storage.objects;
create policy volunteer_docs_public_insert on storage.objects for insert to anon
  with check (bucket_id = 'volunteer-docs' and name like 'inbox/%');
drop policy if exists volunteer_docs_view on storage.objects;
create policy volunteer_docs_view on storage.objects for select to authenticated
  using (bucket_id = 'volunteer-docs' and public.can_view('volunteers'));
drop policy if exists volunteer_docs_edit on storage.objects;
create policy volunteer_docs_edit on storage.objects for delete to authenticated
  using (bucket_id = 'volunteer-docs' and public.can_edit('volunteers'));

-- ---------- 2. class update posted -> admins ----------
create or replace function public.trg_class_update_admin_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text; target text; sname text;
begin
  if new.teacher_email is not null then
    select first_name || ' ' || last_name into who from public.teachers where lower(email) = lower(new.teacher_email) limit 1;
  end if;
  who := coalesce(who, new.teacher_email, 'A teacher');
  if new.enrollment_id is not null then
    select s.first_name || ' ' || s.last_name into sname
    from public.enrollments e join public.students s on s.id = e.student_id where e.id = new.enrollment_id;
    target := coalesce(sname, 'one student');
  else
    select name into target from public.grades where id = new.grade_id;
    target := coalesce(target, 'a class');
  end if;
  perform public.notify_admins(
    'Class update: ' || coalesce(new.subject, 'General') || ' · ' || target,
    who || ' posted a ' || coalesce(new.subject, 'General') || ' update for ' || target ||
      case when new.homework_due is not null then ' (homework due ' || to_char(new.homework_due, 'Mon DD') || ')' else '' end ||
      ': ' || left(regexp_replace(coalesce(new.note, ''), '\s+', ' ', 'g'), 140) ||
      case when length(coalesce(new.note, '')) > 140 then '…' else '' end,
    'info', '/admin/updates', false);
  return new;
end; $$;
drop trigger if exists class_updates_admin_notify on public.class_updates;
create trigger class_updates_admin_notify after insert on public.class_updates
  for each row execute function public.trg_class_update_admin_notify();
