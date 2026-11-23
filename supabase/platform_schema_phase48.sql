-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 48 (President 2026-11-22): activity alerts + phone notifications
--
--   1. Activity alerts. Everything the Activity report records now also raises an alert, as it
--      happens (bell + phone, never e-mail):
--        - done by a STAFF login  -> the full admins only (never copied to staff, parents, teachers)
--        - done by a TEACHER or a PARENT -> the admins (and, by the phase 46 rule, the staff
--          logins that hold the page's permission)
--      One alert per action: a teacher marking attendance for a whole class, or uploading ten
--      workbook pages for one child, writes many rows but is told once (identical alerts within
--      two minutes are not repeated). Things that already raise their own, more specific alert
--      (class updates, health and media-consent forms, new teacher requests, volunteer
--      applications) are left to it.
--   2. Phone notifications (Web Push), for everyone: admins, staff, teachers, parents. Every
--      notification is also pushed to the devices its recipient has switched on, even when the
--      portal is closed. $0: the browser makers' own push services, sent by the Edge Function
--      `push-send` (free tier), called from the database with pg_net.
--      The function creates and keeps its own signing key in push_config (readable by the service
--      role only); nobody ever types or sees it. It also writes its own address into
--      app_settings.push_url. Until that has happened once, this phase changes nothing.
-- Needs phase 47 (alert_admins, admin_only). Run in dev AND prod. Re-runnable.
-- After running: deploy supabase/functions/push-send (JWT verification OFF) and open
--   https://<project>.supabase.co/functions/v1/push-send?init=1   once.
-- ================================================================

-- ---------- 1. activity alerts ----------
create or replace function public.trg_audit_alert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rl text; nm text; op text; ent text := new.entity;
  v jsonb := coalesce(new.new_value, new.old_value, '{}'::jsonb);
  verb text; thing text; target text; lnk text; chg text; sname text; gname text;
  sid uuid; eid uuid; ttl text; msg text;
begin
  if new.actor is null then return null; end if;                      -- the office scripts and scheduled jobs
  select p.role, coalesce(nullif(trim(p.full_name), ''), 'Someone') into rl, nm from public.profiles p where p.id = new.actor;
  if rl is null or rl = 'admin' then return null; end if;             -- an admin's own work is not news to the admins
  op := split_part(new.action, '_', 1);

  -- already announced by their own triggers
  if ent in ('class_updates', 'medical_info', 'media_consent', 'volunteer_applications') then return null; end if;
  if ent in ('teacher_requests', 'teacher_request_notes') and rl <> 'staff' then return null; end if;

  -- an update that changed nothing a person would call a change (sign-in stamps, sync stamps) is not an alert
  if op = 'update' and new.old_value is not null and new.new_value is not null then
    select string_agg(replace(q.k, '_', ' '), ', ' order by q.k) into chg
      from (select n.key as k from jsonb_each(new.new_value) n
             where n.value is distinct from (new.old_value -> n.key)
               and n.key not in ('updated_at', 'created_at', 'synced_at', 'app_last_sign_in', 'updated_by', 'reviewed_at',
                                 'reviewed_by', 'checked_at', 'edited_at', 'last_seen_at', 'recorded_by')
             limit 6) q;
    if chg is null then return null; end if;
  end if;

  begin sid := nullif(v->>'student_id', '')::uuid; exception when others then sid := null; end;
  begin eid := nullif(v->>'enrollment_id', '')::uuid; exception when others then eid := null; end;
  if ent = 'students' then begin sid := new.entity_id::uuid; exception when others then null; end; end if;
  if eid is not null then
    select e.student_id, g.name into sid, gname from public.enrollments e left join public.grades g on g.id = e.grade_id where e.id = eid;
  end if;
  if sid is not null then select trim(first_name || ' ' || last_name) into sname from public.students where id = sid; end if;

  target := coalesce(nullif(v->>'title', ''), nullif(v->>'name', ''), nullif(v->>'full_name', ''),
                     nullif(trim(coalesce(v->>'first_name', '') || ' ' || coalesce(v->>'last_name', '')), ''));

  thing := case ent
    when 'students' then 'a student record'            when 'student' then 'a student'
    when 'enrollments' then 'an enrollment'            when 'guardians' then 'parent details'
    when 'emergency_contacts' then 'an emergency contact'
    when 'applicants' then 'an application'            when 'applicant' then 'an application'
    when 'teachers' then 'a teacher record'            when 'fee_plans' then 'a fee plan'
    when 'payment' then 'a payment'                    when 'payments' then 'a payment'
    when 'calendar_events' then 'a calendar event'     when 'announcements' then 'an announcement'
    when 'staff_permissions' then 'staff permissions'  when 'attendance' then 'attendance'
    when 'assignments' then 'an assignment'            when 'work_uploads' then 'a workbook photo'
    when 'teacher_requests' then 'a teacher request'   when 'teacher_request_notes' then 'a note on a teacher request'
    when 'redcomet_messages' then 'a Red Comet message' when 'parent_students' then 'a parent–child link'
    when 'profiles' then 'a portal account'
    else replace(ent, '_', ' ') end;
  verb := case op when 'insert' then 'added' when 'update' then 'changed' when 'delete' then 'deleted'
                  when 'accept' then 'accepted' when 'withdraw' then 'withdrew' when 'waive' then 'waived' else op end;

  lnk := case
    when ent in ('students', 'student', 'enrollments', 'guardians', 'emergency_contacts') then '/admin/students' || coalesce('/' || sid::text, '')
    when ent in ('applicants', 'applicant') then '/admin/admissions'
    when ent = 'teachers' then '/admin/teachers' || coalesce('/' || nullif(new.entity_id, ''), '')
    when ent in ('fee_plans', 'payment', 'payments') then '/admin/fees'
    when ent = 'calendar_events' then '/admin/calendar'
    when ent = 'announcements' then '/admin/announcements'
    when ent = 'staff_permissions' then '/admin/settings'
    when ent = 'attendance' then '/admin/attendance'
    when ent = 'assignments' then '/admin/assignments'
    when ent = 'work_uploads' then '/admin/redcomet'
    when ent in ('teacher_requests', 'teacher_request_notes') then '/admin/teacher-requests'
    when ent = 'redcomet_messages' then '/admin/redcomet/messages'
    when ent in ('parent_students', 'profiles') then '/admin/parents'
    when ent like 'ptm\_%' then '/admin/meetings'
    when ent like 'social\_%' then '/admin/social'
    else '/admin/reports/activity' end;

  -- what it was about
  if ent = 'attendance' then
    if op = 'insert' then
      verb := 'marked';
      msg := coalesce(gname, 'A class') || coalesce(' · ' || to_char((v->>'date')::date, 'Dy Mon DD'), '');   -- same for the whole class: one alert
    else
      msg := coalesce(sname, 'A student') || ': ' || coalesce(new.old_value->>'status', '—') || ' → ' || coalesce(new.new_value->>'status', '—')
             || coalesce(' (' || to_char((v->>'date')::date, 'Mon DD') || ')', '');
      chg := null;
    end if;
  elsif ent = 'work_uploads' then
    msg := coalesce(nullif(v->>'subject', ''), 'Workbook') || coalesce(' · ' || sname, '');
  elsif ent = 'calendar_events' then
    msg := coalesce(target, 'Event') || coalesce(' (' || to_char((v->>'start_date')::date, 'Mon DD') || ')', '');
  elsif ent in ('payment', 'payments') then
    msg := coalesce('$' || (v->>'amount'), 'Payment') || coalesce(' · ' || (v->>'payment_date'), '');
  elsif ent = 'assignments' then
    msg := coalesce(target, 'Assignment') || coalesce(' · ' || nullif(v->>'subject', ''), '') || coalesce(' · ' || coalesce(sname, gname), '');
  else
    msg := coalesce(target, '');
    if sname is not null and position(sname in msg) = 0 then
      msg := case when msg = '' then sname else msg || ' — ' || sname end;
    end if;
  end if;
  if chg is not null then msg := msg || case when msg = '' then '' else ' · ' end || 'changed: ' || chg; end if;
  msg := left(coalesce(nullif(msg, ''), '—'), 500);
  ttl := left(nm || ' ' || verb || ' ' || thing, 200);

  -- one alert per action, not one per row
  if exists (select 1 from public.notifications x
              where x.title = ttl and x.message = msg and x.link_path is not distinct from lnk
                and x.created_at > now() - interval '2 minutes') then
    return null;
  end if;

  perform public.alert_admins(ttl, msg, lnk, case when op in ('delete', 'withdraw') then 'important' else 'info' end, rl = 'staff');
  return null;
exception when others then
  return null;      -- an alert that cannot be built must never block the work that caused it
end; $$;
revoke execute on function public.trg_audit_alert() from public, anon, authenticated;
drop trigger if exists audit_alert on public.audit_log;
create trigger audit_alert after insert on public.audit_log
  for each row execute function public.trg_audit_alert();

-- ---------- 2. phone notifications ----------
create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles on delete cascade,
  endpoint    text not null unique,        -- the browser's push address for this device
  p256dh      text not null,
  auth        text not null,
  device      text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fails       int not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
grant select on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
grant usage, select on sequence public.push_subscriptions_id_seq to service_role;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select using (user_id = auth.uid());

-- the signing key pair: created by the Edge Function on its first run, read by the service role only
create table if not exists public.push_config (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,               -- given to browsers when they subscribe
  private_jwk jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.push_config enable row level security;      -- no policy: no browser can read it
revoke all on public.push_config from public, anon, authenticated;
grant all on public.push_config to service_role;

create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = public as $$
  select public_key from public.push_config where id = 1
$$;
revoke execute on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;

-- this device, for the signed-in person. The same browser signing in as someone else moves over.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_device text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  -- only the browser makers' own push services (Chrome/Edge/Android, Firefox, Windows, Safari):
  -- the sender never posts to an address a signed-in user made up
  if coalesce(p_endpoint, '') !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.apple\.com)/'
     or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid subscription';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_device, 120))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, fails = 0;
  -- at most 8 devices per person: the oldest make way
  delete from public.push_subscriptions s
   where s.user_id = auth.uid()
     and s.id not in (select id from public.push_subscriptions where user_id = auth.uid() order by coalesce(last_ok_at, created_at) desc limit 8);
end; $$;
revoke execute on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- "is it working?": a notification to yourself, through the same road as every other one
create or replace function public.push_test()
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
  select auth.uid(), 'Notifications are on ✓', 'This device will now get Falah Academy alerts, even when the portal is closed.', 'info', null, true
   where auth.uid() is not null;
$$;
revoke execute on function public.push_test() from public, anon;
grant execute on function public.push_test() to authenticated;

alter table public.notifications add column if not exists pushed_at timestamptz;

-- every new notification -> the Edge Function, which sends it to the recipient's devices.
-- pg_net posts in the background, so the work that created the notification never waits.
create or replace function public.trg_notification_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare u text;
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.recipient_id) then return null; end if;
  select value into u from public.app_settings where key = 'push_url';
  if coalesce(u, '') = '' then return null; end if;      -- the function has not been set up in this project
  perform net.http_post(url := u, headers := '{"Content-Type": "application/json"}'::jsonb,
                        body := jsonb_build_object('id', new.id));
  return null;
exception when others then
  return null;      -- a push that cannot be sent must never block the notification itself
end; $$;
revoke execute on function public.trg_notification_push() from public, anon, authenticated;
drop trigger if exists notification_push on public.notifications;
create trigger notification_push after insert on public.notifications
  for each row execute function public.trg_notification_push();

-- check: 2 triggers, 2 tables, the push address (empty until the function has run once)
select 'triggers' as item, count(*)::text as value from pg_trigger where tgname in ('audit_alert', 'notification_push')
union all select 'push tables', count(*)::text from information_schema.tables
           where table_schema = 'public' and table_name in ('push_subscriptions', 'push_config')
union all select 'push_url', coalesce((select value from public.app_settings where key = 'push_url'), '(not set yet)')
union all select 'signing key', case when exists (select 1 from public.push_config) then 'created' else '(not created yet)' end;
