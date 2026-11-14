-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 46 (President 2026-11-14)
--   Rule: whatever the portal does for "an admin" it does for EVERY admin — every full admin
--   (role admin) and every staff login that holds the matching permission, today and later.
--
--   1. Admin alerts reach every admin: a notification for a full admin that links into an admin
--      page (/admin/<page>) is copied to every staff login with view or edit on that page's
--      module (fan-out trigger). Covers every existing alert (teacher requests, volunteers,
--      applications, medical/contact edits, Red Comet photo checks, parent meetings, …) and any
--      future one, without rewriting each function.
--   2. Teacher requests: any login with EDIT on Teacher Requests may take every decision
--      (under discussion, approve, decline, resolve, reopen) — no longer the President only.
--   3. Live notifications: the notifications table is published to Supabase Realtime, so the bell
--      updates by itself (each person only receives their own rows; RLS applies). $0 (free plan).
--   4. Instant e-mail to parents: a parent's notification is e-mailed the moment it is created
--      (Brevo via email_now; skipped when email_mode = 'off', e.g. dev). The twice-daily job
--      still sends anything that could not go out instantly. $0 up to Brevo's 300 e-mails/day.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. admin alerts -> every admin ----------
-- module behind an admin link (mirrors lib/permissions.ts moduleForPath)
create or replace function public.module_for_admin_link(p text)
returns text language sql immutable as $$
  select case
    when p is null or p not like '/admin/%' then null
    when p like '/admin/teacher-requests%' then 'teacher_requests'
    when p like '/admin/reports/attendance%' then 'report_attendance'
    when p like '/admin/reports/fees%'     then 'report_fees'
    when p like '/admin/reports/activity%' then 'report_activity'
    when p like '/admin/redcomet%'         then 'redcomet'
    when p like '/admin/admissions%'       then 'admissions'
    when p like '/admin/volunteers%'       then 'volunteers'
    when p like '/admin/students%' or p like '/admin/attendance%' then 'students'
    when p like '/admin/parents%' or p like '/admin/parent-activity%' then 'parents'
    when p like '/admin/meetings%'         then 'meetings'
    when p like '/admin/teachers%'         then 'teachers'
    when p like '/admin/fees%'             then 'fees'
    when p like '/admin/updates%' or p like '/admin/assignments%' then 'academics'
    when p like '/admin/calendar%'         then 'calendar'
    when p like '/admin/announcements%'    then 'announcements'
    when p like '/admin/social%'           then 'social'
    when p like '/admin/feedback%'         then 'feedback'
    when p like '/admin/tasks%'            then 'tasks'
    when p like '/admin/settings%'         then 'settings'
    else null end
$$;

alter table public.notifications add column if not exists fanout_of bigint;

create or replace function public.trg_notification_fanout()
returns trigger language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if new.fanout_of is not null then return new; end if;                    -- a copy: never fan out again
  if not exists (select 1 from public.profiles where id = new.recipient_id and role = 'admin') then return new; end if;
  m := public.module_for_admin_link(new.link_path);
  if m is null then return new; end if;
  insert into public.notifications (recipient_id, title, message, priority, link_path, emailed, fanout_of)
  select sp.user_id, new.title, new.message, new.priority, new.link_path, true, new.id
    from public.staff_permissions sp
    join public.profiles p on p.id = sp.user_id and p.role = 'staff' and not coalesce(p.suspended, false)
   where sp.module = m
     and sp.user_id is distinct from auth.uid()                              -- not the person who caused it
     and not exists (select 1 from public.notifications x                    -- one copy per alert, even with several full admins
                      where x.recipient_id = sp.user_id and x.title = new.title and x.message = new.message
                        and x.link_path is not distinct from new.link_path
                        and x.created_at > now() - interval '2 minutes');
  return new;
end; $$;
drop trigger if exists notification_fanout on public.notifications;
create trigger notification_fanout after insert on public.notifications
  for each row execute function public.trg_notification_fanout();

-- ---------- 2. teacher requests: every admin with edit decides ----------
create or replace function public.teacher_request_set_status(p_id bigint, p_status text, p_reason text default null, p_due date default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.teacher_requests; msg text;
begin
  select * into r from public.teacher_requests where id = p_id;
  if not found then raise exception 'request not found'; end if;
  if not public.can_edit('teacher_requests') then raise exception 'not allowed'; end if;   -- phase 46: any admin with edit
  if p_status = 'declined' and coalesce(trim(p_reason), '') = '' then raise exception 'give a short reason for declining'; end if;
  if p_status in ('in_progress', 'done') and r.status not in ('approved', 'in_progress', 'done') then
    raise exception 'approve the request first';
  end if;
  update public.teacher_requests set
    status = p_status,
    decline_reason = case when p_status = 'declined' then trim(p_reason) else null end,
    due_date = coalesce(p_due, due_date),
    decided_by = case when p_status in ('approved', 'declined') then auth.uid() else decided_by end,
    decided_at = case when p_status in ('approved', 'declined') then now() else decided_at end,
    archived_at = case when p_status in ('done', 'declined') then coalesce(archived_at, now()) else null end,
    task_code = case when p_status in ('approved', 'in_progress', 'done') then 'T' || p_id else task_code end,
    updated_at = now()
  where id = p_id;
  if p_status is distinct from r.status then
    msg := 'Status: ' || public.tr_label(p_status)
        || case when p_status = 'declined' then ' — ' || trim(p_reason) else '' end
        || case when p_due is not null then ' (due ' || to_char(p_due, 'Mon DD') || ')' else '' end;
    insert into public.teacher_request_notes (request_id, author_id, kind, body) values (p_id, auth.uid(), 'status', msg);
    perform public.tr_notify(r.created_by, 'Your request R' || p_id || ': ' || public.tr_label(p_status),
                             r.title || case when p_status = 'declined' then ' — ' || trim(p_reason) else '' end,
                             '/teacher/requests?r=' || p_id);
  elsif p_due is not null and p_due is distinct from r.due_date then
    insert into public.teacher_request_notes (request_id, author_id, kind, body)
    values (p_id, auth.uid(), 'status', 'Due date set to ' || to_char(p_due, 'Mon DD, YYYY'));
  end if;
end; $$;
grant execute on function public.teacher_request_set_status(bigint, text, text, date) to authenticated;

-- ---------- 3. live notifications (Supabase Realtime) ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- ---------- 4. instant e-mail for parents ----------
create or replace function public.trg_notification_email_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if new.emailed then return new; end if;
  select email, full_name, role into pr from public.profiles where id = new.recipient_id;
  if pr.role is distinct from 'parent' then return new; end if;
  if public.email_now(pr.email, pr.full_name, new.title, new.message) then
    update public.notifications set emailed = true where id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists notification_email_parent on public.notifications;
create trigger notification_email_parent after insert on public.notifications
  for each row execute function public.trg_notification_email_parent();

-- internal trigger functions: nobody calls them directly (security rule, phase 38)
revoke execute on function public.trg_notification_fanout() from public, anon, authenticated;
revoke execute on function public.trg_notification_email_parent() from public, anon, authenticated;

-- check: should return 3 rows (fanout trigger, email trigger, realtime)
select 'fanout trigger' as item, count(*)::text as ok from pg_trigger where tgname = 'notification_fanout'
union all select 'parent e-mail trigger', count(*)::text from pg_trigger where tgname = 'notification_email_parent'
union all select 'realtime', count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications';
