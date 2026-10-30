-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 30: one-click Suspend / Withdraw / Reinstate (TODO #112)
-- Requested by the President 2026-10-09; replaces the manual SQL of #104.
--   * enrollments.status gains 'suspended' (may return) next to 'withdrawn' (left);
--     enrollments.exit_reason records why.
--   * set_student_status(student, action, date, reason, close_fee, suspend_logins)
--     does everything in one transaction from the Student Profile button:
--       suspend / withdraw : enrollment status + exit date + reason, student archived,
--                            fee plan closed (optional), parent logins suspended when the
--                            family has no other active child (optional), audit_log row
--       reinstate          : the reverse — enrollment active again, student un-archived,
--                            closed fee plans re-opened, the family's logins un-suspended
--     Attendance sheet rows and the class-update roster follow by themselves: the Apps
--     Scripts only read enrollments with status = 'active'.
--   * profiles.suspended is now enforced by the portal (RequireRole shows a notice).
-- Admin → Students → profile: guardians and emergency contacts became editable the same
-- day (#138) — no schema needed, the admin policies existed since phase 7 / the base schema.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

alter table public.enrollments add column if not exists exit_reason text;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.enrollments'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.enrollments drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.enrollments add constraint enrollments_status_check
  check (status in ('active', 'completed', 'withdrawn', 'suspended'));

create or replace function public.set_student_status(
  p_student uuid, p_action text, p_date date default null, p_reason text default null,
  p_close_fee boolean default true, p_suspend_logins boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, (now() at time zone 'America/Los_Angeles')::date);
        enr record; n_fee int := 0; n_par int := 0; pid uuid; before_ jsonb; parents uuid[] := '{}'; new_status text;
begin
  if not (public.is_admin() or public.can_edit('students')) then raise exception 'students permission required'; end if;
  if p_action not in ('suspend', 'withdraw', 'reinstate') then raise exception 'unknown action %', p_action; end if;

  if p_action in ('suspend', 'withdraw') then
    if coalesce(p_reason, '') = '' then raise exception 'a reason is required'; end if;
    select * into enr from public.enrollments where student_id = p_student and status = 'active'
     order by enrollment_date desc limit 1;
    if enr is null then raise exception 'this student has no active enrollment'; end if;
    before_ := to_jsonb(enr);
    new_status := case p_action when 'suspend' then 'suspended' else 'withdrawn' end;
    update public.enrollments set status = new_status, exit_date = d, exit_reason = p_reason where id = enr.id;
    update public.students set archived = true where id = p_student;
    if p_close_fee then
      update public.fee_plans set status = 'closed', end_date = coalesce(end_date, d)
       where enrollment_id = enr.id and status = 'active';
      get diagnostics n_fee = row_count;
    end if;
    if p_suspend_logins then
      for pid in select ps.parent_id from public.parent_students ps where ps.student_id = p_student loop
        -- keep the login if this parent still has another active, non-archived child
        if not exists (select 1 from public.parent_students ps2
                         join public.enrollments e on e.student_id = ps2.student_id and e.status = 'active'
                         join public.students s on s.id = e.student_id and not s.archived
                        where ps2.parent_id = pid and ps2.student_id <> p_student) then
          update public.profiles set suspended = true where id = pid and role = 'parent' and not suspended;
          if found then n_par := n_par + 1; parents := parents || pid; end if;
        end if;
      end loop;
    end if;
    insert into public.audit_log (actor, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), p_action || '_student', 'student', p_student::text, before_,
            jsonb_build_object('enrollment_id', enr.id, 'status', new_status, 'exit_date', d, 'reason', p_reason,
                               'fee_plans_closed', n_fee, 'parents_suspended', to_jsonb(parents)));
    return jsonb_build_object('status', new_status, 'enrollment_id', enr.id, 'fee_plans_closed', n_fee, 'parents_suspended', n_par);
  end if;

  -- reinstate
  select * into enr from public.enrollments where student_id = p_student and status in ('suspended', 'withdrawn')
   order by exit_date desc nulls last, enrollment_date desc limit 1;
  if enr is null then raise exception 'nothing to reinstate: no suspended or withdrawn enrollment'; end if;
  before_ := to_jsonb(enr);
  update public.enrollments
     set status = 'active', exit_date = null, exit_reason = null,
         notes = concat_ws(E'\n', nullif(notes, ''),
                           'Reinstated ' || d || coalesce(' — ' || nullif(p_reason, ''), '')
                           || ' (was ' || enr.status || coalesce(' from ' || enr.exit_date, '') || coalesce(': ' || enr.exit_reason, '') || ')')
   where id = enr.id;
  update public.students set archived = false where id = p_student;
  update public.fee_plans set status = 'active', end_date = null where enrollment_id = enr.id and status = 'closed';
  get diagnostics n_fee = row_count;
  update public.profiles set suspended = false
   where role = 'parent' and suspended and id in (select parent_id from public.parent_students where student_id = p_student);
  get diagnostics n_par = row_count;
  insert into public.audit_log (actor, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), 'reinstate_student', 'student', p_student::text, before_,
          jsonb_build_object('enrollment_id', enr.id, 'date', d, 'reason', p_reason, 'fee_plans_reopened', n_fee, 'parents_unsuspended', n_par));
  return jsonb_build_object('status', 'active', 'enrollment_id', enr.id, 'fee_plans_reopened', n_fee, 'parents_unsuspended', n_par);
end; $$;
grant execute on function public.set_student_status(uuid, text, date, text, boolean, boolean) to authenticated;
