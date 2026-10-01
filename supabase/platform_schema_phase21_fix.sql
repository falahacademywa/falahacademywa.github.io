-- Phase 21 fix (2026-10-01): post_zelle() failed with 'record "f" is not assigned yet'
-- (loop variable and table alias both named f). Replaces the function; nothing else changes.
-- Run in dev AND prod. Re-runnable.

-- Post one alert as payment(s) on the given students' plans. Amount is split
-- plan by plan (each plan gets up to its monthly amount, the last one the rest).
create or replace function public.post_zelle(p_inbox bigint, p_students uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare z record; pl record; remaining numeric; share numeric; n int := 0; pid bigint; pids bigint[] := '{}';
        total int; k text;
begin
  if not (auth.role() = 'service_role' or public.can_edit('fees')) then
    raise exception 'fees permission required';
  end if;
  select * into z from public.zelle_inbox where id = p_inbox for update;
  if z is null then raise exception 'alert not found'; end if;
  if z.status <> 'pending' then raise exception 'alert already %', z.status; end if;
  if p_students is null or array_length(p_students, 1) is null then raise exception 'choose at least one student'; end if;
  remaining := z.amount;
  select count(*) into total
  from public.fee_plans fp join public.enrollments e on e.id = fp.enrollment_id
  where e.status = 'active' and fp.status = 'active' and e.student_id = any(p_students);
  if total = 0 then raise exception 'no active fee plan for the chosen student(s)'; end if;
  for pl in
    select fp.id, fp.total_amount
    from public.fee_plans fp join public.enrollments e on e.id = fp.enrollment_id
    where e.status = 'active' and fp.status = 'active' and e.student_id = any(p_students)
    order by fp.total_amount desc, fp.id
  loop
    n := n + 1;
    share := case when n = total then remaining else least(remaining, pl.total_amount) end;
    if share <= 0 then continue; end if;
    insert into public.payments (fee_plan_id, payment_date, amount, payment_method, reference_no, notes, recorded_by)
    values (pl.id, (z.received_at at time zone 'America/Los_Angeles')::date, share, 'zelle',
            'Zelle ' || to_char(z.received_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI'),
            'Zelle from ' || z.payer || coalesce(' — "' || z.memo || '"', '') || ' · ' || coalesce(p_note, 'posted from the bank alert'),
            auth.uid())
    returning id into pid;
    pids := pids || pid;
    remaining := remaining - share;
  end loop;
  update public.zelle_inbox
     set status = 'posted', matched_student_ids = p_students, posted_payment_ids = pids,
         match_note = coalesce(p_note, match_note), resolved_at = now(), resolved_by = auth.uid()
   where id = p_inbox;
  -- remember the payer for next month
  k := public.payer_key(z.payer);
  insert into public.known_payers (payer_key, payer, student_ids, created_by)
  values (k, z.payer, p_students, auth.uid())
  on conflict (payer_key) do update set payer = excluded.payer, student_ids = excluded.student_ids;
  return jsonb_build_object('posted', true, 'payments', to_jsonb(pids), 'students', to_jsonb(p_students));
end; $$;

