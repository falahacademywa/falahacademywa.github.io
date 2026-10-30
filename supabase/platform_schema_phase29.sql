-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 29: "Waived" fee status (TODO #105)
-- President 2026-10-06 ("we will need it more often"), build approved 2026-10-30.
-- Until now a waived month was faked as a payment with method 'other' and a
-- WAIVED reference, which inflated "Total received", minted a receipt number,
-- queued a receipt e-mail and had to be excluded by hand from QBO matching.
--
--   1. payments.payment_method gains the value 'waived' (+ waiver_reason,
--      waiver_approved_by). A waived row covers its period_month like a payment
--      but is NOT money: no receipt number, no receipt e-mail, excluded from
--      "received" totals everywhere (portal + exports); receipt_data() keeps
--      waived amounts out of "paid" and takes them off "due".
--   2. waive_fee_month(): the Admin → Fees "Waive month" button (fees permission).
--   3. Triggers: receipt defaults skip the receipt number; the receipt queue
--      sends the family a plain "fee waived" in-app note instead of a receipt;
--      audit_log gets a 'waive_fee' row on insert (updates/deletes were logged
--      already). A real payment edited into a waiver withdraws its receipt.
--   4. Migration of the two faked rows (method 'other', reference 'WAIVED …')
--      with the triggers muted, so no "withdrawn" e-mail goes out.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. column + constraint ----------
alter table public.payments add column if not exists waiver_reason text;
alter table public.payments add column if not exists waiver_approved_by text;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.payments'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%payment_method%' loop
    execute format('alter table public.payments drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.payments add constraint payments_payment_method_check
  check (payment_method in ('cash', 'check', 'bank', 'zelle', 'other', 'waived'));
alter table public.payments drop constraint if exists payments_waiver_reason_check;
alter table public.payments add constraint payments_waiver_reason_check
  check (payment_method <> 'waived' or coalesce(waiver_reason, '') <> '');
create index if not exists payments_waived_idx on public.payments (fee_plan_id, period_month) where payment_method = 'waived';

-- ---------- 2. the office action ----------
create or replace function public.waive_fee_month(
  p_plan uuid, p_period date, p_amount numeric default null, p_reason text default null, p_approved_by text default 'President')
returns bigint language plpgsql security definer set search_path = public as $$
declare per date := date_trunc('month', p_period)::date; amt numeric; pid bigint;
begin
  if not public.can_edit('fees') then raise exception 'fees permission required'; end if;
  if coalesce(p_reason, '') = '' then raise exception 'a reason is required'; end if;
  select coalesce(p_amount, f.total_amount) into amt from public.fee_plans f where f.id = p_plan;
  if amt is null then raise exception 'fee plan not found'; end if;
  if amt < 0 then raise exception 'amount must be zero or more'; end if;
  if exists (select 1 from public.payments p where p.fee_plan_id = p_plan and p.period_month = per and p.payment_method = 'waived') then
    raise exception 'this month is already waived';
  end if;
  insert into public.payments (fee_plan_id, payment_date, amount, payment_method, waiver_reason, waiver_approved_by,
                               recorded_by, period_month, receipt_sent_at)
  values (p_plan, (now() at time zone 'America/Los_Angeles')::date, amt, 'waived', p_reason, nullif(p_approved_by, ''),
          auth.uid(), per, now())
  returning id into pid;
  return pid;
end; $$;
grant execute on function public.waive_fee_month(uuid, date, numeric, text, text) to authenticated;

-- ---------- 3. triggers ----------
-- 3a. no receipt number for a waiver
create or replace function public.payments_receipt_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.period_month is null then new.period_month := date_trunc('month', new.payment_date)::date; end if;
  new.period_month := date_trunc('month', new.period_month)::date;
  if new.payment_method = 'waived' then
    new.receipt_no := null; new.receipt_path := null;
    if new.receipt_sent_at is null then new.receipt_sent_at := now(); end if;   -- nothing to send
    return new;
  end if;
  if new.receipt_no is null then
    new.receipt_no := 'R-' || to_char((now() at time zone 'America/Los_Angeles'), 'YYYY') || '-' || nextval('public.receipt_seq');
  end if;
  return new;
end; $$;

-- 3b. receipt queue: waivers get a plain note, never a receipt
create or replace function public.payments_receipt_queue()
returns trigger language plpgsql security definer set search_path = public as $$
declare rno text; sname text; pid uuid; muted boolean := coalesce(current_setting('app.mute_receipt_triggers', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    select s.first_name into sname from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
      join public.students s on s.id = e.student_id where f.id = new.fee_plan_id;
    if new.payment_method = 'waived' then
      if muted then return new; end if;
      for pid in select ps.parent_id from public.parent_students ps
                  join public.fee_plans f on f.id = new.fee_plan_id
                  join public.enrollments e on e.id = f.enrollment_id and e.student_id = ps.student_id loop
        insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
        values (pid, 'Tuition waived — ' || to_char(new.period_month, 'FMMonth YYYY'),
                'The ' || to_char(new.period_month, 'FMMonth YYYY') || ' tuition for ' || coalesce(sname, 'your child')
                || ' has been waived by the school. Nothing is due for this month. — Muneeb Abbasi, Principal, Falah Academy',
                'info', '/parent', true);
      end loop;
      return new;
    end if;
    insert into public.receipt_outbox (kind, receipt_group) values ('receipt', new.receipt_group) on conflict do nothing;
    -- in-app note to every linked parent, once per group (the e-mail with the PDF follows from the Action)
    select min(receipt_no) into rno from public.payments where receipt_group = new.receipt_group;
    for pid in select ps.parent_id from public.parent_students ps
                join public.fee_plans f on f.id = new.fee_plan_id
                join public.enrollments e on e.id = f.enrollment_id and e.student_id = ps.student_id loop
      if not exists (select 1 from public.notifications where recipient_id = pid and title = 'Receipt ' || rno) then
        insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
        values (pid, 'Receipt ' || rno,
                'JazakAllah khair — $' || to_char(new.amount, 'FM999990.00') || ' received by ' || new.payment_method ||
                ' for ' || coalesce(sname, 'your child') || ', ' || to_char(new.period_month, 'FMMonth YYYY') ||
                '. The PDF receipt follows by e-mail; it is also under Fees in the portal.',
                'info', '/parent', true);
      end if;
    end loop;
    return new;
  elsif tg_op = 'UPDATE' then
    if muted then return new; end if;
    if new.payment_method = 'waived' then
      -- a real payment turned into a waiver: its receipt is withdrawn (same wording as a delete)
      if old.payment_method <> 'waived' and old.receipt_no is not null and old.receipt_sent_at is not null then
        insert into public.receipt_outbox (kind, receipt_group, receipt_no, payload)
        select 'withdrawn', old.receipt_group, old.receipt_no,
               jsonb_build_object('amount', old.amount, 'payment_date', old.payment_date, 'method', old.payment_method,
                                  'period_label', to_char(old.period_month, 'FMMonth YYYY'),
                                  'student', s.first_name || ' ' || s.last_name, 'to_email', r.email, 'to_name', r.name)
          from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id join public.students s on s.id = e.student_id
          left join lateral public.family_recipient(array[s.id]) r on true
         where f.id = old.fee_plan_id;
      end if;
      new.receipt_no := null; new.receipt_path := null; new.receipt_kind := 'receipt';
      if new.receipt_sent_at is null then new.receipt_sent_at := now(); end if;
      return new;
    end if;
    if old.payment_method = 'waived' then
      -- a waiver turned into a real payment: number it and send a receipt like a new payment
      new.receipt_no := 'R-' || to_char((now() at time zone 'America/Los_Angeles'), 'YYYY') || '-' || nextval('public.receipt_seq');
      new.receipt_sent_at := null; new.receipt_kind := 'receipt';
      insert into public.receipt_outbox (kind, receipt_group) values ('receipt', new.receipt_group) on conflict do nothing;
      return new;
    end if;
    if new.receipt_sent_at is not null and (new.amount <> old.amount or new.payment_date <> old.payment_date
        or new.payment_method <> old.payment_method or new.period_month <> old.period_month
        or coalesce(new.reference_no, '') <> coalesce(old.reference_no, '') or new.fee_plan_id <> old.fee_plan_id) then
      new.receipt_kind := 'corrected';
      new.receipt_sent_at := null;
      insert into public.receipt_outbox (kind, receipt_group) values ('corrected', new.receipt_group) on conflict do nothing;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if muted or old.payment_method = 'waived' then return old; end if;   -- removing a waiver withdraws nothing
    if old.receipt_sent_at is not null or exists (select 1 from public.receipt_outbox where receipt_group = old.receipt_group and sent_at is not null) then
      insert into public.receipt_outbox (kind, receipt_group, receipt_no, payload)
      select 'withdrawn', old.receipt_group, old.receipt_no,
             jsonb_build_object('amount', old.amount, 'payment_date', old.payment_date, 'method', old.payment_method,
                                'period_label', to_char(old.period_month, 'FMMonth YYYY'),
                                'student', s.first_name || ' ' || s.last_name, 'to_email', r.email, 'to_name', r.name)
        from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id join public.students s on s.id = e.student_id
        left join lateral public.family_recipient(array[s.id]) r on true
       where f.id = old.fee_plan_id;
    end if;
    -- a pending (unsent) receipt for this group is dropped with the row
    delete from public.receipt_outbox where receipt_group = old.receipt_group and kind in ('receipt', 'corrected') and sent_at is null
      and not exists (select 1 from public.payments where receipt_group = old.receipt_group and id <> old.id);
    return old;
  end if;
  return null;
end; $$;

-- 3c. audit: waivers are logged when created (edits/deletes of any payment were logged since phase 13)
create or replace function public.payments_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.payment_method = 'waived' then
      insert into public.audit_log (actor, action, entity, entity_id, new_value)
      values (auth.uid(), 'waive_fee', 'payment', new.id::text, to_jsonb(new));
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), case when new.payment_method = 'waived' and old.payment_method <> 'waived' then 'waive_fee'
                             else 'update_payment' end, 'payment', old.id::text, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action, entity, entity_id, old_value)
    values (auth.uid(), case when old.payment_method = 'waived' then 'remove_waiver' else 'delete_payment' end,
            'payment', old.id::text, to_jsonb(old));
    return old;
  end if;
  return null;
end; $$;
drop trigger if exists payments_audit on public.payments;
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.payments_audit();

-- 3d. receipt_data(): waived amounts are not "paid"; they reduce what is due
create or replace function public.receipt_data(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rows_ jsonb; kids uuid[]; rcpt record; first_ record; total numeric; period date; due numeric; paid_ numeric; waived_ numeric;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'receipt_no', p.receipt_no, 'amount', p.amount,
           'student', s.first_name || ' ' || s.last_name, 'grade', e.grade_name,
           'plan_amount', f.total_amount, 'fee_plan_id', f.id) order by p.receipt_no), '[]'::jsonb),
         array_agg(distinct s.id), min(p.period_month), sum(p.amount)
    into rows_, kids, period, total
    from public.payments p
    join public.fee_plans f on f.id = p.fee_plan_id
    join public.enrollments e on e.id = f.enrollment_id
    join public.students s on s.id = e.student_id
   where p.receipt_group = p_group and p.payment_method <> 'waived';
  if kids is null then return null; end if;
  select * into first_ from public.payments where receipt_group = p_group and payment_method <> 'waived' order by receipt_no limit 1;
  select * into rcpt from public.family_recipient(kids);
  -- balance for the period across the plans on this receipt
  select coalesce(sum(f.total_amount), 0) into due
    from public.fee_plans f where f.id in (select fee_plan_id from public.payments where receipt_group = p_group)
     and f.status = 'active' and f.billing_frequency = 'monthly';
  select coalesce(sum(p.amount) filter (where p.payment_method <> 'waived'), 0),
         coalesce(sum(p.amount) filter (where p.payment_method = 'waived'), 0)
    into paid_, waived_
    from public.payments p
   where p.fee_plan_id in (select fee_plan_id from public.payments where receipt_group = p_group)
     and p.period_month = period;
  due := greatest(due - waived_, 0);
  return jsonb_build_object(
    'receipt_no', first_.receipt_no, 'kind', first_.receipt_kind, 'group', p_group,
    'payment_date', first_.payment_date, 'method', first_.payment_method, 'reference', first_.reference_no,
    'period_month', period, 'period_label', to_char(period, 'FMMonth YYYY'),
    'total', total, 'period_due', due, 'period_paid', paid_, 'period_waived', waived_, 'balance', greatest(due - paid_, 0),
    'lines', rows_,
    'to_email', rcpt.email, 'to_name', rcpt.name, 'to_parent_id', rcpt.parent_id,
    'parent_ids', (select coalesce(jsonb_agg(distinct ps.parent_id), '[]'::jsonb) from public.parent_students ps where ps.student_id = any(kids)));
end; $$;
-- family_balance() (reminders) is unchanged on purpose: a waived month counts as covered, so no reminder goes out.

-- ---------- 4. migrate the faked rows ----------
do $$
begin
  perform set_config('app.mute_receipt_triggers', 'on', true);
  update public.payments
     set payment_method = 'waived',
         waiver_reason = coalesce(nullif(waiver_reason, ''), regexp_replace(reference_no, '^WAIVED\s*-\s*', '')),
         waiver_approved_by = coalesce(waiver_approved_by, 'President'),
         reference_no = null, receipt_no = null, receipt_path = null, receipt_kind = 'receipt',
         receipt_sent_at = coalesce(receipt_sent_at, now())
   where payment_method = 'other' and reference_no ilike 'WAIVED%';
  perform set_config('app.mute_receipt_triggers', 'off', true);
end $$;
