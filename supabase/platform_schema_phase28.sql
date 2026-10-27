-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 28: Wednesday reminder for teachers
-- President 2026-10-22: every Wednesday morning each teacher with app access
-- gets ONE notification (in-app banner in the teacher app + e-mail through the
-- daily dispatcher) reminding them to upload the week's Red Comet workbook
-- photos and post the weekly class update. One per teacher, not per student.
-- Called by platform-notifications.yml right after run_daily_notifications().
-- Run in dev AND prod. Re-runnable.
-- ================================================================
create or replace function public.run_teacher_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; today_local date; t record;
begin
  today_local := (now() at time zone 'America/Los_Angeles')::date;
  if extract(isodow from today_local) <> 3 then return 0; end if;      -- Wednesday only
  for t in
    select tc.user_id, tc.first_name
      from public.teachers tc
     where tc.app_access and tc.active and tc.user_id is not null
       and not exists (select 1 from public.notifications x
                        where x.recipient_id = tc.user_id and x.title = 'Red Comet photos this week'
                          and x.created_at > now() - interval '6 days')
  loop
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    values (t.user_id, 'Red Comet photos this week',
            'Assalamu Alaikum ' || t.first_name || ', it is Wednesday — please upload this week''s Red Comet workbook pages for your students '
            || 'on the Red Comet tab (English, Maths, Science), and post the weekly class update for parents. '
            || 'JazakAllah khair. — Muneeb Abbasi, Principal, Falah Academy',
            'important', '/teacher/progress');
    n := n + 1;
  end loop;
  return n;
end; $$;
revoke all on function public.run_teacher_reminders() from public, anon, authenticated;   -- service role (the Action) only
grant execute on function public.run_teacher_reminders() to service_role;

-- teachers mark their own reminders read from the app banner
drop policy if exists notif_update_own on public.notifications;
create policy notif_update_own on public.notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
