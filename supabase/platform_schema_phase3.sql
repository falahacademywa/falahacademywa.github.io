-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 3 + 4 schema
-- Qur'an progress, Academic progress, Fees (FR-006..FR-008 domain),
-- and the notification engine (FR-016).
-- Run AFTER platform_schema.sql and platform_schema_phase2.sql. Re-runnable.
-- ================================================================

-- ---------------- Qur'an learning (Qur'an teacher's domain) ----------------
create table if not exists public.quran_progress (
  id bigserial primary key,
  enrollment_id uuid not null references public.enrollments on delete cascade,
  assessment_date date not null default current_date,
  category text not null default 'quran'
    check (category in ('qaida', 'quran', 'dua', 'tajweed')),
  surah_topic text not null,          -- 'Surah Al-Fil', 'Qaida p.14', 'Dua before sleeping'
  ayah_from int,
  ayah_to int,
  memorization_level text
    check (memorization_level in ('introduced', 'practicing', 'memorized', 'mastered')),
  recitation_level text,
  teacher_comment text,
  revision text,                      -- what to practice at home
  recorded_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

-- ---------------- Academic progress (Red Comet manual entry in V1) ----------------
create table if not exists public.academic_progress (
  id bigserial primary key,
  enrollment_id uuid not null references public.enrollments on delete cascade,
  subject text not null,
  assessment_type text not null default 'progress',   -- 'progress' | 'quiz' | 'test' | 'report'
  score numeric,
  max_score numeric,
  assessment_date date not null default current_date,
  notes text,
  recorded_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

-- ---------------- Fees (BR-010: one plan per enrollment) ----------------
create table if not exists public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid unique not null references public.enrollments on delete cascade,
  plan_name text not null default 'Standard',
  total_amount numeric not null default 0,     -- $0 plans get no reminders (BR-121)
  billing_frequency text not null default 'monthly'
    check (billing_frequency in ('monthly', 'quarterly', 'yearly', 'one-time')),
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'closed')),
  notes text
);

create table if not exists public.payments (
  id bigserial primary key,
  fee_plan_id uuid not null references public.fee_plans on delete cascade,
  payment_date date not null default current_date,
  amount numeric not null,
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'check', 'bank', 'zelle', 'other')),
  reference_no text,
  notes text,
  recorded_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

-- profiles.email so the email dispatcher doesn't need the auth admin API
alter table public.profiles add column if not exists email text;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;
update public.profiles p set email = u.email
from auth.users u where u.id = p.id and p.email is null;

alter table public.notifications add column if not exists emailed boolean not null default false;

-- ---------------- RLS ----------------
alter table public.quran_progress enable row level security;
alter table public.academic_progress enable row level security;
alter table public.fee_plans enable row level security;
alter table public.payments enable row level security;

create or replace function public.enrollment_is_my_child(eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e
                 where e.id = eid and public.is_my_child(e.student_id))
$$;

drop policy if exists qp_select on public.quran_progress;
create policy qp_select on public.quran_progress for select
  using (public.is_admin() or public.enrollment_is_my_child(enrollment_id));
drop policy if exists qp_admin on public.quran_progress;
create policy qp_admin on public.quran_progress for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ap_select on public.academic_progress;
create policy ap_select on public.academic_progress for select
  using (public.is_admin() or public.enrollment_is_my_child(enrollment_id));
drop policy if exists ap_admin on public.academic_progress;
create policy ap_admin on public.academic_progress for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists fp_select on public.fee_plans;
create policy fp_select on public.fee_plans for select
  using (public.is_admin() or public.enrollment_is_my_child(enrollment_id));
drop policy if exists fp_admin on public.fee_plans;
create policy fp_admin on public.fee_plans for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists pay_select on public.payments;
create policy pay_select on public.payments for select
  using (public.is_admin() or exists (
    select 1 from public.fee_plans f
    where f.id = fee_plan_id and public.enrollment_is_my_child(f.enrollment_id)));
drop policy if exists pay_admin on public.payments;
create policy pay_admin on public.payments for all
  using (public.is_admin()) with check (public.is_admin());

-- ================================================================
-- NOTIFICATION ENGINE (FR-016)
-- ================================================================

-- Helper: notify every parent of a student
create or replace function public.notify_parents_of_student(
  sid uuid, p_title text, p_message text, p_priority text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, title, message, priority, link_path)
  select ps.parent_id, p_title, p_message, p_priority, p_link
  from public.parent_students ps where ps.student_id = sid;
end; $$;

-- BR-119: payment received
create or replace function public.trg_payment_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select e.student_id into sid
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
  where f.id = new.fee_plan_id;
  if sid is not null then
    perform public.notify_parents_of_student(
      sid, 'Payment received',
      'A payment of $' || new.amount || ' was recorded on ' || new.payment_date || '. JazakAllah khair.',
      'info', '/parent');
  end if;
  return new;
end; $$;
drop trigger if exists payment_notify on public.payments;
create trigger payment_notify after insert on public.payments
  for each row execute function public.trg_payment_notify();

-- BR-119: Qur'an teacher comment / revision assigned
create or replace function public.trg_quran_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; sname text;
begin
  select e.student_id, s.first_name into sid, sname
  from public.enrollments e join public.students s on s.id = e.student_id
  where e.id = new.enrollment_id;
  if new.teacher_comment is not null or new.revision is not null then
    perform public.notify_parents_of_student(
      sid, 'Qur''an update for ' || sname,
      coalesce('Teacher note: ' || new.teacher_comment || '. ', '') ||
      coalesce('Revision: ' || new.revision, ''),
      'important', '/parent');
  end if;
  return new;
end; $$;
drop trigger if exists quran_notify on public.quran_progress;
create trigger quran_notify after insert on public.quran_progress
  for each row execute function public.trg_quran_notify();

-- BR-120: attendance alerts — 3 consecutive absences OR 3 lates in rolling 2 weeks
create or replace function public.trg_attendance_alert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sid uuid; sname text;
  consec int; lates int;
begin
  select e.student_id, s.first_name into sid, sname
  from public.enrollments e join public.students s on s.id = e.student_id
  where e.id = new.enrollment_id;

  if new.status = 'absent' then
    select count(*) into consec from (
      select status from public.attendance
      where enrollment_id = new.enrollment_id and date <= new.date
      order by date desc limit 3
    ) last3 where status = 'absent';
    if consec = 3 then
      perform public.notify_parents_of_student(
        sid, 'Attendance alert: ' || sname,
        sname || ' has been marked absent 3 school days in a row. Please contact the school office.',
        'action', '/parent');
    end if;
  end if;

  if new.status = 'late' then
    select count(*) into lates from public.attendance
    where enrollment_id = new.enrollment_id and status = 'late'
      and date >= new.date - interval '14 days' and date <= new.date;
    if lates = 3 then
      perform public.notify_parents_of_student(
        sid, 'Late arrivals: ' || sname,
        sname || ' has been marked late 3 times in the last two weeks.',
        'important', '/parent');
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists attendance_alert on public.attendance;
create trigger attendance_alert after insert or update of status on public.attendance
  for each row execute function public.trg_attendance_alert();

-- BR-119: new published announcement -> notify targeted parents
create or replace function public.trg_announcement_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    select distinct ps.parent_id,
      case when new.category = 'emergency' then 'EMERGENCY: ' || new.title else new.title end,
      left(new.content, 200),
      case when new.category = 'emergency' then 'action'
           when new.requires_ack then 'important' else 'info' end,
      '/parent'
    from public.parent_students ps
    join public.enrollments e on e.student_id = ps.student_id and e.status = 'active'
    where new.grade_id is null or e.grade_id = new.grade_id;
  end if;
  return new;
end; $$;
drop trigger if exists announcement_notify on public.announcements;
create trigger announcement_notify after insert or update of status on public.announcements
  for each row execute function public.trg_announcement_notify();

-- BR-119/BR-121: fee overdue after the 15th (skips $0 plans; once per month)
-- Called daily by the scheduled GitHub Action with the service key.
create or replace function public.run_daily_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if extract(day from (now() at time zone 'America/Los_Angeles')) < 16 then
    return 0;
  end if;
  with due as (
    select e.student_id, s.first_name, f.id as plan_id
    from public.fee_plans f
    join public.enrollments e on e.id = f.enrollment_id and e.status = 'active'
    join public.students s on s.id = e.student_id
    where f.status = 'active' and f.total_amount > 0
      and not exists (   -- no payment yet this calendar month
        select 1 from public.payments p
        where p.fee_plan_id = f.id
          and date_trunc('month', p.payment_date) =
              date_trunc('month', (now() at time zone 'America/Los_Angeles')::date))
  ), targets as (
    select distinct ps.parent_id, d.first_name, d.student_id
    from due d join public.parent_students ps on ps.student_id = d.student_id
    where not exists (   -- don't repeat the reminder within the same month
      select 1 from public.notifications x
      where x.recipient_id = ps.parent_id
        and x.title = 'Fee reminder'
        and date_trunc('month', x.created_at) = date_trunc('month', now()))
  )
  insert into public.notifications (recipient_id, title, message, priority, link_path)
  select parent_id, 'Fee reminder',
    'This month''s fee has not been recorded yet. If you have already paid, please disregard — records may take a day to update.',
    'important', '/parent'
  from targets;
  get diagnostics n = row_count;
  return n;
end; $$;
