-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 5 schema: Class Updates
-- Teacher notes (per subject, via Google Form) with optional photo,
-- class-wide or individual (Qur'an). Evening digest notifications.
-- Run AFTER phases 1-4. Re-runnable.
-- ================================================================

create table if not exists public.class_updates (
  id uuid primary key default gen_random_uuid(),
  grade_id int references public.grades,            -- set for class-wide
  enrollment_id uuid references public.enrollments, -- set for individual (Qur'an)
  subject text not null default 'General',
  note text not null,
  attachment_url text,                              -- Drive view link
  attachment_thumb text,                            -- inline-image URL (Drive thumbnail)
  update_date date not null default current_date,
  homework_due date,                                -- optional; also mirrored to assignments
  teacher_email text,
  created_at timestamptz not null default now(),
  check (grade_id is not null or enrollment_id is not null)
);

alter table public.class_updates enable row level security;

drop policy if exists cu_select on public.class_updates;
create policy cu_select on public.class_updates for select using (
  public.is_admin()
  or (grade_id is not null and public.has_child_in_grade(grade_id))
  or (enrollment_id is not null and public.enrollment_is_my_child(enrollment_id))
);

-- Writes come from the Form sync (service role, bypasses RLS) and admin.
drop policy if exists cu_admin on public.class_updates;
create policy cu_admin on public.class_updates for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------- Evening digest (FR-016 aligned: action, not noise) ----------------
-- Extends the daily-notifications function: one notification per parent per
-- day when their children's classes posted updates in the last 24h.
create or replace function public.run_daily_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int := 0;
begin
  -- Fee reminders after the 15th (unchanged)
  if extract(day from (now() at time zone 'America/Los_Angeles')) >= 16 then
    with due as (
      select e.student_id, s.first_name, f.id as plan_id
      from public.fee_plans f
      join public.enrollments e on e.id = f.enrollment_id and e.status = 'active'
      join public.students s on s.id = e.student_id
      where f.status = 'active' and f.total_amount > 0
        and not exists (
          select 1 from public.payments p
          where p.fee_plan_id = f.id
            and date_trunc('month', p.payment_date) =
                date_trunc('month', (now() at time zone 'America/Los_Angeles')::date))
    ), targets as (
      select distinct ps.parent_id
      from due d join public.parent_students ps on ps.student_id = d.student_id
      where not exists (
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
  end if;

  -- Class-updates digest: one per parent per day, only when updates exist
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

  return n + m;
end; $$;
