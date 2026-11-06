-- Phase 37 (2026-11-05, President): follow-ups to teacher requests (phase 35) and Red Comet pages.
--
--   * Closed requests are read-only: once a request is Resolved (done) or Declined, nobody can add
--     a note (and, as before, the teacher cannot edit or delete it). The President or an admin can
--     Reopen it first if something needs saying.
--   * Request notifications show the latest only: a new notification about a request replaces the
--     older ones for the same person and the same request (one per request in the bell and on the
--     teacher app's Today screen). Existing duplicates are cleared once below.
--   * Red Comet "photo needs a look" alerts show the latest only too: one alert per person, student
--     and subject, saying how many photos of that subject are waiting (record_photo_check below).
--   * Red Comet: teachers enter the last workbook page in the photos they send, per subject. The
--     teacher app shows "Last page uploaded: N" for each subject of the chosen student
--     (work_uploads.page_last, the most recent upload that has one).
--
-- Safe to run more than once.

-- ---------- Red Comet: last page per upload ----------
alter table public.work_uploads add column if not exists page_last integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_uploads_page_last_chk') then
    alter table public.work_uploads add constraint work_uploads_page_last_chk check (page_last is null or page_last between 1 and 9999);
  end if;
end $$;
create index if not exists work_uploads_last_page_idx on public.work_uploads (enrollment_id, subject, created_at desc) where page_last is not null;

-- ---------- closed requests take no more notes ----------
create or replace function public.teacher_request_add_note(p_id bigint, p_body text, p_internal boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r public.teacher_requests; admin boolean := public.can_edit('teacher_requests');
begin
  select * into r from public.teacher_requests where id = p_id;
  if not found or not public.tr_visible(r) then raise exception 'request not found'; end if;
  if not admin and not public.is_teacher() then raise exception 'not allowed'; end if;
  if r.status in ('done', 'declined') then raise exception 'this request is closed; reopen it to add a note'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'empty note'; end if;
  insert into public.teacher_request_notes (request_id, author_id, kind, internal, body)
  values (p_id, auth.uid(), 'note', admin and coalesce(p_internal, false), trim(p_body));
  update public.teacher_requests set updated_at = now() where id = p_id;
  if admin and not coalesce(p_internal, false) then
    perform public.tr_notify(r.created_by, 'Note on your request R' || p_id, trim(p_body), '/teacher/requests?r=' || p_id);
  elsif not admin then
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    select a.id, 'Teacher note on R' || p_id, left(trim(p_body), 240), 'info', '/admin/teacher-requests?r=' || p_id
      from public.profiles a where a.role = 'admin' and a.id <> auth.uid();
  end if;
end; $$;
grant execute on function public.teacher_request_add_note(bigint, text, boolean) to authenticated;

-- ---------- request notifications: latest only ----------
create or replace function public.notifications_request_latest_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.notifications
   where recipient_id = new.recipient_id and link_path = new.link_path and id <> new.id;
  return null;
end; $$;
drop trigger if exists notifications_request_latest_only on public.notifications;
create trigger notifications_request_latest_only after insert on public.notifications
  for each row when (new.link_path ~ '^/(teacher/requests|admin/teacher-requests)\?r=[0-9]+$'
                  or new.link_path ~ '^/(teacher/progress\?student=|admin/redcomet\?check=flagged&student=)[^&]+&subject=')
  execute function public.notifications_request_latest_only();

-- ---------- Red Comet photo check: one alert per person, student and subject ----------
-- Same as phase 31, except: the link carries the student and the subject (the pages ignore the
-- extra parameters), so the trigger above keeps only the newest alert per person, student and
-- subject; and the text counts every photo of that student and subject still waiting for a look.
create or replace function public.record_photo_check(p_id bigint, p_ok boolean, p_label text, p_score numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; who uuid; notes jsonb := '[]'::jsonb; nid bigint; em text; nm text;
        sname text; gname text; cnt int; subj text; msg text;
begin
  select wu.*, s.first_name, g.name as grade_name into w
    from public.work_uploads wu
    join public.enrollments e on e.id = wu.enrollment_id
    join public.students s on s.id = e.student_id
    join public.grades g on g.id = e.grade_id
   where wu.id = p_id;
  if w is null then return jsonb_build_object('found', false); end if;
  if w.check_status <> 'pending' then return jsonb_build_object('found', true, 'skipped', w.check_status); end if;
  update public.work_uploads
     set check_status = case when p_ok then 'ok' else 'flagged' end,
         check_label = p_label, check_score = p_score, checked_at = now()
   where id = p_id;
  if p_ok then return jsonb_build_object('found', true, 'flagged', false); end if;

  sname := btrim(w.first_name); gname := w.grade_name; subj := coalesce(w.subject, 'workbook');
  select count(*) into cnt from public.work_uploads
   where enrollment_id = w.enrollment_id and subject is not distinct from w.subject and check_status = 'flagged';
  msg := case when cnt <= 1 then
      'A ' || subj || ' photo for ' || sname || ' (' || gname || ', ' || to_char(w.taken_at, 'Mon DD') ||
      ') does not look like a workbook page (' || coalesce(p_label, 'unclear') || '). Open it and delete it, or mark it as school work. It will not go to the office until then.'
    else
      cnt || ' ' || subj || ' photos for ' || sname || ' (' || gname || ', latest ' || to_char(w.taken_at, 'Mon DD') ||
      ') do not look like workbook pages (latest: ' || coalesce(p_label, 'unclear') || '). Open them and delete them, or mark them as school work. They will not go to the office until then.'
    end;
  for who in
    select distinct x.uid from (
      select w.uploaded_by as uid
      union select t.user_id from public.teachers t
              join public.teacher_grades tg on tg.teacher_id = t.id
              join public.school_years y on y.id = tg.school_year_id and y.is_current
              join public.enrollments e on e.id = w.enrollment_id and e.grade_id = tg.grade_id
             where t.user_id is not null and t.app_access and t.active
      union select p.id from public.profiles p where p.role = 'admin'
      union select sp.user_id from public.staff_permissions sp where sp.module = 'redcomet' and sp.level = 'edit'
    ) x where x.uid is not null
  loop
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    values (who, 'Red Comet photo needs a look', msg, 'action',
            case when exists (select 1 from public.profiles where id = who and role in ('admin', 'staff'))
                 then '/admin/redcomet?check=flagged&student=' || w.enrollment_id || '&subject=' || subj
                 else '/teacher/progress?student=' || w.enrollment_id || '&subject=' || subj end)
    returning id into nid;
    select email, full_name into em, nm from public.profiles where id = who;
    notes := notes || jsonb_build_object('id', nid, 'email', em, 'name', nm);
  end loop;
  return jsonb_build_object('found', true, 'flagged', true, 'student', sname, 'grade', gname,
                            'subject', w.subject, 'taken_at', w.taken_at, 'path', w.path, 'notifications', notes);
end; $$;
revoke all on function public.record_photo_check(bigint, boolean, text, numeric) from public, anon, authenticated;
grant execute on function public.record_photo_check(bigint, boolean, text, numeric) to service_role;

-- one-off: keep only the newest request notification per person and request
delete from public.notifications n
 where n.link_path ~ '^/(teacher/requests|admin/teacher-requests)\?r=[0-9]+$'
   and exists (select 1 from public.notifications m
                where m.recipient_id = n.recipient_id and m.link_path = n.link_path
                  and (m.created_at, m.id) > (n.created_at, n.id));

-- one-off: older photo-check alerts (links without the subject) - keep the newest per person and link
delete from public.notifications n
 where n.title = 'Red Comet photo needs a look'
   and exists (select 1 from public.notifications m
                where m.title = n.title and m.recipient_id = n.recipient_id and m.link_path = n.link_path
                  and (m.created_at, m.id) > (n.created_at, n.id));

select 'phase 37 ok' as result,
  (select count(*) from information_schema.columns where table_name = 'work_uploads' and column_name = 'page_last') as page_col,
  (select count(*) from pg_trigger where tgname = 'notifications_request_latest_only') as trigger_ok;
