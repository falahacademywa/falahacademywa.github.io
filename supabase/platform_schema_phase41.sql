-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 41: fee e-mails are manual only (President 2026-11-10, P0)
--   1. run_daily_notifications() v4: NO automatic tuition statement (1st) or reminders
--      (6th, 15th) any more. The class-updates digest is unchanged. Receipts stay automatic.
--   2. app_settings (key/value): the late-fee reminder subject + message (the President's
--      own wording, edited on Admin → Fees) and email_mode ('off' in DEV only).
--   3. fee_late_families(month): families with tuition still due for that month after the
--      5th (due date), one row per family, with the last reminder sent.
--   4. send_fee_reminders(month, families, subject, message): only when the President (or
--      staff with Fees: edit) clicks Send — e-mail now to the family's primary contact,
--      in-app copy to every linked parent; logged in fee_reminders.
--   5. email_now(): sends nothing when app_settings.email_mode = 'off' (dev); keeps line breaks.
-- Run in dev AND prod. Re-runnable. In DEV ONLY also run platform_dev_email_off.sql.
-- ================================================================

-- ---------- 1. daily rules v4 (no fee e-mails) ----------
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
  return m;
end; $$;
revoke execute on function public.run_daily_notifications() from public, anon, authenticated;
grant execute on function public.run_daily_notifications() to service_role;

-- ---------- 2. app_settings ----------
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.app_settings enable row level security;
grant select, insert, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated
  using (public.is_admin() or (key like 'fee\_%' and public.can_view('fees')));
drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check (public.is_admin() or (key like 'fee\_%' and public.can_edit('fees')));
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.is_admin() or (key like 'fee\_%' and public.can_edit('fees')))
  with check (public.is_admin() or (key like 'fee\_%' and public.can_edit('fees')));

create or replace function public.app_settings_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end; $$;
drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before insert or update on public.app_settings
  for each row execute function public.app_settings_touch();

insert into public.app_settings (key, value) values
  ('fee_reminder_subject', 'Tuition reminder — {month}'),
  ('fee_reminder_message',
   'Our records show {amount} still due for {month} ({children}). Tuition is due by the 5th of each month.' || chr(10) || chr(10) ||
   'If you paid in the last day or two, please ignore this message. You can pay by Zelle to falahacademywa@gmail.com (child''s name in the memo), by cheque at the office, or by bank deposit.' || chr(10) || chr(10) ||
   'JazakAllahu khairan,' || chr(10) || 'Muneeb Abbasi, Principal, Falah Academy')
on conflict (key) do nothing;

-- ---------- 5. email_now: off in dev, line breaks kept ----------
create or replace function public.email_now(p_to text, p_name text, p_subject text, p_message text)
returns boolean language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p_to is null or p_to like '%test.local%' then return false; end if;
  if exists (select 1 from public.app_settings where key = 'email_mode' and value = 'off') then return false; end if;
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
      'htmlContent', '<p>Assalamu Alaikum ' || public.html_escape(p_name) || ',</p><p>' ||
        replace(public.html_escape(p_message), chr(10), '<br>') ||
        '</p><p>Details: <a href="https://falahacademywa.org/platform/">Family Portal</a></p><p>— Falah Academy</p>'));
  return true;
exception when others then
  return false;
end; $$;
revoke execute on function public.email_now(text, text, text, text) from public, anon, authenticated;
grant execute on function public.email_now(text, text, text, text) to service_role;

-- ---------- reminder log ----------
create table if not exists public.fee_reminders (
  id           bigserial primary key,
  period_month date not null,
  family_key   text not null,               -- primary-contact parent id, or the guardian e-mail
  parent_id    uuid references public.profiles(id) on delete set null,
  to_email     text,
  emailed      boolean not null default false,
  amount_due   numeric(10,2),
  subject      text not null,
  message      text not null,
  sent_at      timestamptz not null default now(),
  sent_by      uuid references public.profiles(id) on delete set null
);
create index if not exists fee_reminders_period_idx on public.fee_reminders (period_month, family_key);
alter table public.fee_reminders enable row level security;
grant select on public.fee_reminders to authenticated;
grant all on public.fee_reminders to service_role;
grant usage, select on sequence public.fee_reminders_id_seq to service_role;
drop policy if exists fee_reminders_read on public.fee_reminders;
create policy fee_reminders_read on public.fee_reminders for select to authenticated
  using (public.is_admin() or public.can_view('fees'));
-- writes only through send_fee_reminders (security definer)

-- ---------- 3. who is late ----------
-- One row per family for a month: the family is everyone reached through the same
-- primary recipient (family_recipient: primary-contact login → any login → guardian e-mail).
-- Late = the month is before this month, or it is this month and today is after the 5th.
-- Waived months count as covered (a waiver is a payments row).
create or replace function public.fee_late_families(p_month date)
returns table (family_key text, parent_id uuid, to_name text, to_email text, student_ids uuid[],
               children text, due numeric, paid numeric, balance numeric,
               last_reminded timestamptz, reminders_sent int)
language plpgsql stable security definer set search_path = public as $$
declare mon date := date_trunc('month', p_month)::date;
        today_local date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if not (public.is_admin() or public.can_view('fees')) then raise exception 'fees permission required'; end if;
  if mon > date_trunc('month', today_local)::date then return; end if;
  if mon = date_trunc('month', today_local)::date and extract(day from today_local) <= 5 then return; end if;
  return query
  with plans as (
    select s.id as student_id, s.first_name, e.grade_name, f.id as plan_id, f.total_amount
      from public.fee_plans f
      join public.enrollments e on e.id = f.enrollment_id and e.status = 'active'
      join public.students s on s.id = e.student_id and not coalesce(s.archived, false)
     where f.status = 'active' and f.billing_frequency = 'monthly' and f.total_amount > 0
       and (f.start_date is null or f.start_date <= (mon + interval '1 month - 1 day')::date)
  ), per_student as (
    select pl.*, coalesce((select sum(p.amount) from public.payments p
                            where p.fee_plan_id = pl.plan_id and p.period_month = mon), 0) as paid_amt,
           r.email as r_email, r.name as r_name, r.parent_id as r_parent
      from plans pl
      left join lateral public.family_recipient(array[pl.student_id]) r on true
  ), fam as (
    select coalesce(ps.r_parent::text, lower(ps.r_email), 'student:' || ps.student_id::text) as fkey,
           (array_agg(ps.r_parent))[1] as fparent,
           nullif((array_agg(case when ps.r_name like '%@%' then null else ps.r_name end))[1], '') as fname,   -- a login without a name shows its e-mail: greet "Parent" instead
           (array_agg(ps.r_email))[1] as femail,
           array_agg(ps.student_id order by ps.first_name) as sids,
           string_agg(ps.first_name || ' (' || ps.grade_name || ')', ', ' order by ps.first_name) as kids,
           sum(ps.total_amount) as fdue, sum(least(ps.paid_amt, ps.total_amount)) as fpaid
      from per_student ps
     group by 1
  )
  select f.fkey, f.fparent, f.fname, f.femail, f.sids, f.kids, f.fdue, f.fpaid, f.fdue - f.fpaid,
         (select max(x.sent_at) from public.fee_reminders x where x.family_key = f.fkey and x.period_month = mon),
         (select count(*)::int from public.fee_reminders x where x.family_key = f.fkey and x.period_month = mon)
    from fam f
   where f.fdue - f.fpaid > 0
   order by f.kids;
end; $$;
revoke execute on function public.fee_late_families(date) from public, anon;
grant execute on function public.fee_late_families(date) to authenticated, service_role;

-- ---------- 4. send (manual only) ----------
-- Placeholders in subject/message: {parent} {children} {month} {amount}
create or replace function public.send_fee_reminders(p_month date, p_families text[], p_subject text, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mon date := date_trunc('month', p_month)::date; f record; subj text; body text; pid uuid;
        emailed_n int := 0; inapp_n int := 0; fam_n int := 0; ok boolean;
begin
  if not (public.is_admin() or public.can_edit('fees')) then raise exception 'fees edit permission required'; end if;
  if coalesce(btrim(p_subject), '') = '' or coalesce(btrim(p_message), '') = '' then raise exception 'subject and message are required'; end if;
  if p_families is null or array_length(p_families, 1) is null then raise exception 'choose at least one family'; end if;
  for f in select * from public.fee_late_families(mon) l where l.family_key = any(p_families) loop
    subj := replace(replace(replace(replace(p_subject, '{month}', to_char(mon, 'FMMonth YYYY')),
              '{amount}', '$' || to_char(f.balance, 'FM999990')), '{children}', coalesce(f.children, '')), '{parent}', coalesce(f.to_name, 'Parent'));
    body := replace(replace(replace(replace(p_message, '{month}', to_char(mon, 'FMMonth YYYY')),
              '{amount}', '$' || to_char(f.balance, 'FM999990')), '{children}', coalesce(f.children, '')), '{parent}', coalesce(f.to_name, 'Parent'));
    -- e-mail now to the family's primary recipient
    ok := public.email_now(f.to_email, coalesce(f.to_name, 'Parent'), subj, body);
    if ok then emailed_n := emailed_n + 1; end if;
    -- in-app copy to every parent linked to these children (already e-mailed → emailed = true,
    -- so the daily dispatcher never sends it a second time)
    for pid in select distinct ps.parent_id from public.parent_students ps where ps.student_id = any(f.student_ids) loop
      insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
      values (pid, subj, body, 'important', '/parent', true);
      inapp_n := inapp_n + 1;
    end loop;
    insert into public.fee_reminders (period_month, family_key, parent_id, to_email, emailed, amount_due, subject, message, sent_by)
    values (mon, f.family_key, f.parent_id, f.to_email, ok, f.balance, subj, body, auth.uid());
    fam_n := fam_n + 1;
  end loop;
  return jsonb_build_object('families', fam_n, 'emailed', emailed_n, 'in_app', inapp_n);
end; $$;
revoke execute on function public.send_fee_reminders(date, text[], text, text) from public, anon;
grant execute on function public.send_fee_reminders(date, text[], text, text) to authenticated;
