-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 42: President's reports + activity log; Academics & Qur'an removed
-- (President 2026-11-10)
--   1. report_attendance(from, to): every attendance mark in the range with grade and student
--   2. report_fees(from_month, to_month): one row per student per month — due, paid, waived,
--      status (paid on time / paid late / partly paid / unpaid / waived) and how it was paid
--   3. activity_feed(from, to): what people did — page visits (portal_events), changes
--      (audit_log) and sign-ins (auth log) — with the person's name and role
--   Each report has its own permission module (report_attendance, report_fees,
--   report_activity): admins always; staff only when granted in Staff & Permissions.
--   4. more tables write to the audit log (attendance, class updates, assignments, links,
--      profiles, teacher requests, feedback, settings); every signed-in user may log page visits
--   5. page visits older than 400 days are removed by the daily job
--   6. academic_progress and quran_progress dropped (never used; Qur'an notes are class updates)
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. attendance ----------
create or replace function public.report_attendance(p_from date, p_to date)
returns table (att_date date, status text, enrollment_id uuid, student_id uuid, student text,
               student_no int, grade text, grade_order int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.can_view('report_attendance')) then raise exception 'report permission required'; end if;
  return query
  select a.date, a.status::text, e.id, s.id, s.first_name || ' ' || s.last_name, s.student_no::int,
         e.grade_name, coalesce(g.level_order, 99)
    from public.attendance a
    join public.enrollments e on e.id = a.enrollment_id
    join public.students s on s.id = e.student_id
    left join public.grades g on g.id = e.grade_id
   where a.date between p_from and p_to
   order by a.date, e.grade_name, s.first_name;
end; $$;
revoke execute on function public.report_attendance(date, date) from public, anon;
grant execute on function public.report_attendance(date, date) to authenticated;

-- ---------- 2. fees ----------
-- status per student-month: 'waived' (covered by a waiver), 'paid' (on or before the 5th),
-- 'paid_late' (fully paid after the 5th), 'partial', 'unpaid', 'not_due' (current month, not yet the 6th)
create or replace function public.report_fees(p_from date, p_to date)
returns table (month date, student_id uuid, student text, student_no int, grade text, grade_order int,
               due numeric, paid numeric, waived numeric, balance numeric, status text,
               last_payment date, methods text)
language plpgsql stable security definer set search_path = public as $$
declare today_local date := (now() at time zone 'America/Los_Angeles')::date;
        cur date := date_trunc('month', (now() at time zone 'America/Los_Angeles'))::date;
begin
  if not (public.is_admin() or public.can_view('report_fees')) then raise exception 'report permission required'; end if;
  return query
  with months as (
    select generate_series(date_trunc('month', p_from)::date, least(date_trunc('month', p_to)::date, cur), interval '1 month')::date as m
  ), plans as (
    select f.id as plan_id, f.total_amount, f.start_date, s.id as sid, s.first_name || ' ' || s.last_name as sname,
           s.student_no::int as sno, e.grade_name as gname, coalesce(g.level_order, 99) as gord
      from public.fee_plans f
      join public.enrollments e on e.id = f.enrollment_id
      join public.students s on s.id = e.student_id
      left join public.grades g on g.id = e.grade_id
     where f.billing_frequency = 'monthly' and f.total_amount > 0 and f.status = 'active' and e.status = 'active'
  ), grid as (
    select mo.m, pl.* from months mo join plans pl
      on pl.start_date is null or pl.start_date <= (mo.m + interval '1 month - 1 day')::date
  ), money as (
    select gr.m, gr.sid, gr.sname, gr.sno, gr.gname, gr.gord, gr.total_amount,
           coalesce(sum(p.amount) filter (where p.payment_method <> 'waived'), 0) as paid_amt,
           coalesce(sum(p.amount) filter (where p.payment_method = 'waived'), 0) as waived_amt,
           max(p.payment_date) filter (where p.payment_method <> 'waived') as last_pay,
           string_agg(distinct p.payment_method, ', ') filter (where p.payment_method <> 'waived') as meths
      from grid gr
      left join public.payments p on p.fee_plan_id = gr.plan_id and p.period_month = gr.m
     group by gr.m, gr.sid, gr.sname, gr.sno, gr.gname, gr.gord, gr.total_amount
  )
  select mo.m, mo.sid, mo.sname, mo.sno, mo.gname, mo.gord, mo.total_amount, mo.paid_amt, mo.waived_amt,
         greatest(mo.total_amount - mo.paid_amt - mo.waived_amt, 0),
         case
           when mo.waived_amt > 0 and mo.paid_amt + mo.waived_amt >= mo.total_amount and mo.paid_amt = 0 then 'waived'
           when mo.paid_amt + mo.waived_amt >= mo.total_amount then
             case when mo.last_pay is not null and mo.last_pay > (mo.m + 4) then 'paid_late' else 'paid' end
           when mo.m = cur and extract(day from today_local) <= 5 then 'not_due'
           when mo.paid_amt + mo.waived_amt > 0 then 'partial'
           else 'unpaid' end,
         mo.last_pay, mo.meths
    from money mo
   order by mo.m, mo.gord, mo.sname;
end; $$;
revoke execute on function public.report_fees(date, date) from public, anon;
grant execute on function public.report_fees(date, date) to authenticated;

-- ---------- 3. activity ----------
create or replace function public.activity_feed(p_from timestamptz, p_to timestamptz)
returns table (at timestamptz, user_id uuid, person text, role text, kind text, action text,
               entity text, entity_id text, detail text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.can_view('report_activity')) then raise exception 'report permission required'; end if;
  return query
  select e.occurred_at, e.user_id, coalesce(p.full_name, p.email, 'unknown'), coalesce(p.role, '?')::text,
         case when e.event = 'page' then 'visit' else 'action' end, e.event, null::text, null::text, e.detail
    from public.portal_events e left join public.profiles p on p.id = e.user_id
   where e.occurred_at between p_from and p_to
  union all
  select a.at, a.actor, coalesce(p.full_name, p.email, 'system'), coalesce(p.role, 'system')::text,
         'change', a.action, a.entity, a.entity_id,
         concat_ws(' · ',
           nullif(btrim(concat_ws(' ',
             coalesce(a.new_value, a.old_value) ->> 'first_name', coalesce(a.new_value, a.old_value) ->> 'last_name')), ''),
           coalesce(a.new_value, a.old_value) ->> 'title',
           coalesce(a.new_value, a.old_value) ->> 'full_name',
           coalesce(a.new_value, a.old_value) ->> 'name',
           coalesce(a.new_value, a.old_value) ->> 'subject',
           case when a.old_value is not null and a.new_value is not null then
             'changed: ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(a.new_value) k
                             where k not in ('updated_at', 'synced_at') and a.old_value -> k is distinct from a.new_value -> k)
           end)
    from public.audit_log a left join public.profiles p on p.id = a.actor
   where a.at between p_from and p_to;
  -- sign-ins from Supabase Auth's own log (kept by Supabase for a limited time)
  if to_regclass('auth.audit_log_entries') is not null then
    return query
    select l.created_at, (l.payload ->> 'actor_id')::uuid, coalesce(p.full_name, p.email, l.payload ->> 'actor_username', 'unknown'),
           coalesce(p.role, '?')::text, 'sign-in', l.payload ->> 'action', null::text, null::text,
           nullif(l.payload ->> 'log_type', '')
      from auth.audit_log_entries l
      left join public.profiles p on p.id = (l.payload ->> 'actor_id')::uuid
     where l.created_at between p_from and p_to
       and l.payload ->> 'action' in ('login', 'logout', 'user_recovery_requested', 'user_updated_password')
       and (l.payload ->> 'actor_id') ~ '^[0-9a-f-]{36}$';
  end if;
end; $$;
revoke execute on function public.activity_feed(timestamptz, timestamptz) from public, anon;
grant execute on function public.activity_feed(timestamptz, timestamptz) to authenticated;

-- ---------- 4. more tables in the audit log; page visits for every role ----------
do $$
declare t text;
begin
  foreach t in array array['attendance', 'class_updates', 'assignments', 'parent_students', 'profiles',
                           'teacher_requests', 'teacher_request_notes', 'feedback', 'app_settings', 'fee_reminders']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %s_audit_generic on public.%I', t, t);
      execute format('create trigger %s_audit_generic after insert or update or delete on public.%I for each row execute function public.row_audit_generic()', t, t);
    end if;
  end loop;
end $$;
-- portal_events: the insert policy (user_id = auth.uid()) already lets any signed-in user log
-- their own visits; make sure the role can insert and use the sequence
grant insert on public.portal_events to authenticated;
grant usage, select on sequence public.portal_events_id_seq to authenticated;
create index if not exists portal_events_time on public.portal_events (occurred_at desc);
create index if not exists audit_log_at on public.audit_log (at desc);

-- ---------- 5. retention: page visits kept 400 days (daily job) ----------
create or replace function public.run_daily_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare m int := 0;
begin
  -- Tuition statement / reminders were removed in phase 41: the office sends late-fee
  -- reminders by hand from Admin → Fees (send_fee_reminders).

  -- Class-updates digest (unchanged from phase 6)
  with fresh as (
    select cu.id, cu.grade_id, cu.enrollment_id
    from public.class_updates cu
    where cu.created_at > now() - interval '24 hours'
  ), recipients as (
    select ps.parent_id, count(distinct f.id) as cnt
    from fresh f
    join public.enrollments e
      on (f.grade_id is not null and e.grade_id = f.grade_id and e.status = 'active')
      or (f.enrollment_id is not null and e.id = f.enrollment_id)
    join public.parent_students ps on ps.student_id = e.student_id
    group by ps.parent_id
  )
  insert into public.notifications (recipient_id, title, message, priority, link_path)
  select r.parent_id, 'New class updates',
    r.cnt || ' new update' || case when r.cnt = 1 then '' else 's' end ||
    ' from your child''s teachers today. Open the portal to read them.',
    'info', '/parent'
  from recipients r
  where not exists (
    select 1 from public.notifications x
    where x.recipient_id = r.parent_id
      and x.title = 'New class updates'
      and x.created_at > now() - interval '20 hours');
  get diagnostics m = row_count;

  -- phase 42: page visits are kept for 400 days (a full school year and a bit)
  delete from public.portal_events where event = 'page' and occurred_at < now() - interval '400 days';
  return m;
end; $$;
revoke execute on function public.run_daily_notifications() from public, anon, authenticated;
grant execute on function public.run_daily_notifications() to service_role;

-- ---------- 6. Academics & Qur'an removed ----------
drop table if exists public.academic_progress cascade;
drop table if exists public.quran_progress cascade;
