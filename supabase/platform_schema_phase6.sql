-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 6: fee policy
-- Fees begin 2026-09-01 and are due by the 5th of each month.
-- Reminders fire after the 5th (was: after the 15th) and never
-- before a plan's start_date. Run in BOTH dev and prod. Re-runnable.
-- ================================================================

-- Existing plans start with the school year
update public.fee_plans set start_date = date '2026-09-01' where start_date is null;

create or replace function public.run_daily_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int := 0; today_local date;
begin
  today_local := (now() at time zone 'America/Los_Angeles')::date;

  -- Fee reminders: after the 5th, for started plans with no payment this month
  if extract(day from today_local) >= 6 then
    with due as (
      select e.student_id
      from public.fee_plans f
      join public.enrollments e on e.id = f.enrollment_id and e.status = 'active'
      where f.status = 'active' and f.total_amount > 0
        and (f.start_date is null or f.start_date <= today_local)
        and not exists (
          select 1 from public.payments p
          where p.fee_plan_id = f.id
            and date_trunc('month', p.payment_date) = date_trunc('month', today_local))
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
      'This month''s fee (due by the 5th) has not been recorded yet. If you have already paid, please disregard — records may take a day to update.',
      'important', '/parent'
    from targets;
    get diagnostics n = row_count;
  end if;

  -- Class-updates digest (unchanged)
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
