-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 27: fee invoices, reminders and receipts
-- TODO #100. President's decisions 2026-10-20 (docs/fee-receipts-plan.md):
--   * invoice e-mail on the 1st, reminders on the 6th and 15th only to families
--     with a balance; one e-mail per family (primary-contact login), in-app
--     copies to the other linked parents; families without a login → father's
--     e-mail from the application
--   * a numbered receipt for every payment (R-<year>-<n>), one receipt per
--     "group" (a Zelle payment split across siblings = one receipt)
--   * PDF receipts are rendered and e-mailed by the hourly GitHub Action
--     platform-receipts.yml (Option B); this script only queues the work
--   * footer = school information, no EIN
-- Supersedes the 2026-09-28 "no parent alert on payments" decision.
--
--   1. payments: receipt_no, receipt_group, period_month, receipt_sent_at,
--      receipt_path, receipt_kind  (+ backfill of numbers and periods)
--   2. receipt_outbox: what the Action still has to send (receipt / corrected /
--      withdrawn), filled by triggers; receipt_data() gives the Action everything
--      it needs for one receipt
--   3. instant in-app notification to the family when a payment is posted
--   4. run_daily_notifications() v3: invoice (1st), reminders (6th, 15th),
--      class-updates digest unchanged; balances use period_month
--   5. post_zelle(): one receipt_group per alert; record_family_payment() for
--      the office; resend_receipt()
--   6. storage bucket `receipts` (private): service role writes, a family reads
--      its own files, admins read all
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. payments columns ----------
create sequence if not exists public.receipt_seq start 1001;
alter table public.payments add column if not exists receipt_no text;
alter table public.payments add column if not exists receipt_group uuid not null default gen_random_uuid();
alter table public.payments add column if not exists period_month date;         -- first day of the month the payment covers
alter table public.payments add column if not exists receipt_sent_at timestamptz;
alter table public.payments add column if not exists receipt_path text;         -- receipts/<year>/<receipt_no>.pdf
alter table public.payments add column if not exists receipt_kind text not null default 'receipt'
  check (receipt_kind in ('receipt', 'corrected'));
create unique index if not exists payments_receipt_no_uq on public.payments (receipt_no) where receipt_no is not null;
create index if not exists payments_receipt_group_idx on public.payments (receipt_group);
create index if not exists payments_period_idx on public.payments (fee_plan_id, period_month);

-- period defaults to the payment month; numbers in payment-date order for the history
update public.payments set period_month = date_trunc('month', payment_date)::date where period_month is null;
do $$
declare r record;
begin
  for r in select id, payment_date from public.payments where receipt_no is null order by payment_date, id loop
    update public.payments
       set receipt_no = 'R-' || to_char(r.payment_date, 'YYYY') || '-' || nextval('public.receipt_seq')
     where id = r.id;
  end loop;
end $$;
-- old payments: the receipt exists in the portal but is not e-mailed retroactively
update public.payments set receipt_sent_at = created_at where receipt_sent_at is null and created_at < now() - interval '1 minute';

create or replace function public.payments_receipt_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.period_month is null then new.period_month := date_trunc('month', new.payment_date)::date; end if;
  new.period_month := date_trunc('month', new.period_month)::date;
  if new.receipt_no is null then
    new.receipt_no := 'R-' || to_char((now() at time zone 'America/Los_Angeles'), 'YYYY') || '-' || nextval('public.receipt_seq');
  end if;
  return new;
end; $$;
drop trigger if exists payments_receipt_defaults on public.payments;
create trigger payments_receipt_defaults before insert on public.payments
  for each row execute function public.payments_receipt_defaults();

-- ---------- 2. outbox for the Action ----------
create table if not exists public.receipt_outbox (
  id            bigserial primary key,
  kind          text not null check (kind in ('receipt', 'corrected', 'withdrawn')),
  receipt_group uuid,                      -- receipt / corrected
  receipt_no    text,                      -- withdrawn (the payment row is gone)
  payload       jsonb,                     -- withdrawn: snapshot for the e-mail
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  result        text
);
alter table public.receipt_outbox enable row level security;   -- no policies: service role only
-- explicit grants (Supabase stops granting new public tables automatically from 2026-10-30)
grant all on public.receipt_outbox to service_role;
grant usage, select on sequence public.receipt_outbox_id_seq to service_role;
grant usage, select on sequence public.receipt_seq to service_role, authenticated;
create unique index if not exists receipt_outbox_pending_uq on public.receipt_outbox (receipt_group, kind) where sent_at is null and receipt_group is not null;

-- who gets the family's e-mail: primary-contact login → any linked login → father/mother guardian e-mail
create or replace function public.family_recipient(p_students uuid[])
returns table (email text, name text, parent_id uuid) language sql stable security definer set search_path = public as $$
  (select p.email, p.full_name, p.id
     from public.parent_students ps join public.profiles p on p.id = ps.parent_id
    where ps.student_id = any(p_students) and p.email is not null
    order by ps.is_primary_contact desc, p.created_at
    limit 1)
  union all
  (select g.email, g.name, null::uuid
     from public.guardians g
    where g.student_id = any(p_students) and g.email is not null
      and not exists (select 1 from public.parent_students ps join public.profiles p on p.id = ps.parent_id
                      where ps.student_id = any(p_students) and p.email is not null)
    order by g.sort
    limit 1)
$$;
revoke all on function public.family_recipient(uuid[]) from public, anon, authenticated;
grant execute on function public.family_recipient(uuid[]) to service_role;

-- everything the Action needs to render and send one receipt (one group)
create or replace function public.receipt_data(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rows_ jsonb; kids uuid[]; rcpt record; first_ record; total numeric; period date; due numeric; paid_ numeric;
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
   where p.receipt_group = p_group;
  if kids is null then return null; end if;
  select * into first_ from public.payments where receipt_group = p_group order by receipt_no limit 1;
  select * into rcpt from public.family_recipient(kids);
  -- balance for the period across the plans on this receipt
  select coalesce(sum(f.total_amount), 0) into due
    from public.fee_plans f where f.id in (select fee_plan_id from public.payments where receipt_group = p_group)
     and f.status = 'active' and f.billing_frequency = 'monthly';
  select coalesce(sum(p.amount), 0) into paid_
    from public.payments p
   where p.fee_plan_id in (select fee_plan_id from public.payments where receipt_group = p_group)
     and p.period_month = period;
  return jsonb_build_object(
    'receipt_no', first_.receipt_no, 'kind', first_.receipt_kind, 'group', p_group,
    'payment_date', first_.payment_date, 'method', first_.payment_method, 'reference', first_.reference_no,
    'period_month', period, 'period_label', to_char(period, 'FMMonth YYYY'),
    'total', total, 'period_due', due, 'period_paid', paid_, 'balance', greatest(due - paid_, 0),
    'lines', rows_,
    'to_email', rcpt.email, 'to_name', rcpt.name, 'to_parent_id', rcpt.parent_id,
    'parent_ids', (select coalesce(jsonb_agg(distinct ps.parent_id), '[]'::jsonb) from public.parent_students ps where ps.student_id = any(kids)));
end; $$;
revoke all on function public.receipt_data(uuid) from public, anon, authenticated;
grant execute on function public.receipt_data(uuid) to service_role;

-- ---------- 3. triggers: queue + instant in-app notification ----------
create or replace function public.payments_receipt_queue()
returns trigger language plpgsql security definer set search_path = public as $$
declare rno text; sname text; pid uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.receipt_outbox (kind, receipt_group) values ('receipt', new.receipt_group) on conflict do nothing;
    -- in-app note to every linked parent, once per group (the e-mail with the PDF follows from the Action)
    select min(receipt_no) into rno from public.payments where receipt_group = new.receipt_group;
    select s.first_name into sname from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
      join public.students s on s.id = e.student_id where f.id = new.fee_plan_id;
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
    if new.receipt_sent_at is not null and (new.amount <> old.amount or new.payment_date <> old.payment_date
        or new.payment_method <> old.payment_method or new.period_month <> old.period_month
        or coalesce(new.reference_no, '') <> coalesce(old.reference_no, '') or new.fee_plan_id <> old.fee_plan_id) then
      new.receipt_kind := 'corrected';
      new.receipt_sent_at := null;
      insert into public.receipt_outbox (kind, receipt_group) values ('corrected', new.receipt_group) on conflict do nothing;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
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
drop trigger if exists payments_receipt_queue_ins on public.payments;
create trigger payments_receipt_queue_ins after insert on public.payments for each row execute function public.payments_receipt_queue();
drop trigger if exists payments_receipt_queue_upd on public.payments;
create trigger payments_receipt_queue_upd before update on public.payments for each row execute function public.payments_receipt_queue();
drop trigger if exists payments_receipt_queue_del on public.payments;
create trigger payments_receipt_queue_del before delete on public.payments for each row execute function public.payments_receipt_queue();

-- ---------- 4. daily rules v3 ----------
create or replace function public.family_balance(p_parent uuid, p_month date)
returns table (due numeric, paid numeric, lines text) language sql stable security definer set search_path = public as $$
  with plans as (
    select distinct f.id, f.total_amount, s.first_name, e.grade_name
      from public.parent_students ps
      join public.enrollments e on e.student_id = ps.student_id and e.status = 'active'
      join public.fee_plans f on f.enrollment_id = e.id and f.status = 'active' and f.billing_frequency = 'monthly' and f.total_amount > 0
      join public.students s on s.id = e.student_id
     where ps.parent_id = p_parent and (f.start_date is null or f.start_date <= (p_month + interval '1 month - 1 day')::date)
  )
  select coalesce(sum(total_amount), 0),
         coalesce((select sum(p.amount) from public.payments p where p.fee_plan_id in (select id from plans) and p.period_month = p_month), 0),
         string_agg(first_name || ' (' || grade_name || ') $' || to_char(total_amount, 'FM999990'), ' · ' order by first_name)
    from plans
$$;
revoke all on function public.family_balance(uuid, date) from public, anon, authenticated;
grant execute on function public.family_balance(uuid, date) to service_role;

create or replace function public.run_daily_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int := 0; k int := 0; today_local date; mon date; d int; fam record; b record;
        title_ text; msg text; is_primary boolean;
begin
  today_local := (now() at time zone 'America/Los_Angeles')::date;
  mon := date_trunc('month', today_local)::date;
  d := extract(day from today_local);

  -- Invoice on the 1st, reminders on the 6th and 15th (TODO #100). One row per
  -- linked parent; only the primary contact is e-mailed (others: in-app only).
  if d in (1, 6, 15) then
    title_ := case d when 1 then 'Tuition for ' || to_char(mon, 'FMMonth YYYY')
                     when 6 then 'Tuition reminder — ' || to_char(mon, 'FMMonth YYYY')
                     else 'Tuition — second reminder, ' || to_char(mon, 'FMMonth YYYY') end;
    for fam in
      select distinct ps.parent_id,
             bool_or(ps.is_primary_contact) as primary_any
        from public.parent_students ps
        join public.enrollments e on e.student_id = ps.student_id and e.status = 'active'
        join public.fee_plans f on f.enrollment_id = e.id and f.status = 'active' and f.total_amount > 0
       group by ps.parent_id
    loop
      if exists (select 1 from public.notifications x where x.recipient_id = fam.parent_id and x.title = title_) then continue; end if;
      select * into b from public.family_balance(fam.parent_id, mon);
      if b.due <= 0 then continue; end if;
      if d <> 1 and b.due - b.paid <= 0 then continue; end if;       -- reminders only with a balance
      -- is this parent the family's primary contact (or the only login)?
      select coalesce(bool_or(ps.is_primary_contact), false)
             or not exists (select 1 from public.parent_students ps2 join public.parent_students ps3 on ps3.student_id = ps2.student_id
                            where ps2.parent_id = fam.parent_id and ps3.parent_id <> fam.parent_id and ps3.is_primary_contact)
        into is_primary from public.parent_students ps where ps.parent_id = fam.parent_id;
      if d = 1 then
        msg := 'Tuition for ' || to_char(mon, 'FMMonth YYYY') || ' is due by ' || to_char(mon + 4, 'FMDay, FMMonth DD') || '. '
            || coalesce(b.lines, '') || ' · Family total $' || to_char(b.due, 'FM999990') || '. '
            || 'Pay by Zelle to falahacademywa@gmail.com with your child''s name in the memo, by cheque at the office, or by bank deposit. '
            || 'Your receipt arrives by e-mail once the payment is recorded. — Muneeb Abbasi, Principal, Falah Academy';
      else
        msg := 'Our records show $' || to_char(b.due - b.paid, 'FM999990') || ' still due for ' || to_char(mon, 'FMMonth YYYY')
            || ' (' || coalesce(b.lines, '') || '). If you paid in the last day or two, please ignore this message — Zelle payments post within the hour and other payments when the office records them. '
            || 'Pay by Zelle to falahacademywa@gmail.com with your child''s name in the memo, by cheque at the office, or by bank deposit. — Muneeb Abbasi, Principal, Falah Academy';
      end if;
      insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
      values (fam.parent_id, title_, msg, case when d = 1 then 'info' else 'important' end, '/parent', not is_primary);
      n := n + 1;
    end loop;
  end if;

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

  return n + m + k;
end; $$;

-- ---------- 5. one receipt per Zelle alert / family payment / resend ----------
create or replace function public.post_zelle(p_inbox bigint, p_students uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare z record; pl record; remaining numeric; share numeric; n int := 0; pid bigint; pids bigint[] := '{}';
        total int; k text; grp uuid := gen_random_uuid(); pday date;
begin
  if not (auth.role() = 'service_role' or public.can_edit('fees')) then
    raise exception 'fees permission required';
  end if;
  select * into z from public.zelle_inbox where id = p_inbox for update;
  if z is null then raise exception 'alert not found'; end if;
  if z.status <> 'pending' then raise exception 'alert already %', z.status; end if;
  if p_students is null or array_length(p_students, 1) is null then raise exception 'choose at least one student'; end if;
  remaining := z.amount;
  pday := (z.received_at at time zone 'America/Los_Angeles')::date;
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
    insert into public.payments (fee_plan_id, payment_date, amount, payment_method, reference_no, notes, recorded_by, receipt_group, period_month)
    values (pl.id, pday, share, 'zelle',
            'Zelle ' || to_char(z.received_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI'),
            'Zelle from ' || z.payer || coalesce(' — "' || z.memo || '"', '') || ' · ' || coalesce(p_note, 'posted from the bank alert'),
            auth.uid(), grp, date_trunc('month', pday)::date)
    returning id into pid;
    pids := pids || pid;
    remaining := remaining - share;
  end loop;
  update public.zelle_inbox
     set status = 'posted', matched_student_ids = p_students, posted_payment_ids = pids,
         match_note = coalesce(p_note, match_note), resolved_at = now(), resolved_by = auth.uid()
   where id = p_inbox;
  k := public.payer_key(z.payer);
  insert into public.known_payers (payer_key, payer, student_ids, created_by)
  values (k, z.payer, p_students, auth.uid())
  on conflict (payer_key) do update set payer = excluded.payer, student_ids = excluded.student_ids;
  return jsonb_build_object('posted', true, 'payments', to_jsonb(pids), 'students', to_jsonb(p_students), 'receipt_group', grp);
end; $$;

-- office: one amount for several children of a family → split like Zelle, one receipt
create or replace function public.record_family_payment(
  p_students uuid[], p_amount numeric, p_method text, p_reference text, p_date date, p_period date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl record; remaining numeric := p_amount; share numeric; n int := 0; total int; pid bigint; pids bigint[] := '{}';
        grp uuid := gen_random_uuid(); per date := date_trunc('month', coalesce(p_period, p_date))::date;
begin
  if not public.can_edit('fees') then raise exception 'fees permission required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
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
    insert into public.payments (fee_plan_id, payment_date, amount, payment_method, reference_no, recorded_by, receipt_group, period_month)
    values (pl.id, p_date, share, p_method, nullif(p_reference, ''), auth.uid(), grp, per) returning id into pid;
    pids := pids || pid;
    remaining := remaining - share;
  end loop;
  return jsonb_build_object('payments', to_jsonb(pids), 'receipt_group', grp);
end; $$;
grant execute on function public.record_family_payment(uuid[], numeric, text, text, date, date) to authenticated;

-- office: send the receipt again (new PDF, same number)
create or replace function public.resend_receipt(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit('fees') then raise exception 'fees permission required'; end if;
  update public.payments set receipt_sent_at = null where receipt_group = p_group;
  insert into public.receipt_outbox (kind, receipt_group) values ('receipt', p_group) on conflict do nothing;
end; $$;
grant execute on function public.resend_receipt(uuid) to authenticated;

-- ---------- 6. storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['application/pdf'];
drop policy if exists receipts_family_read on storage.objects;
create policy receipts_family_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (
    public.is_admin() or public.can_view('fees')
    or exists (select 1 from public.payments p
                 join public.fee_plans f on f.id = p.fee_plan_id
                 join public.enrollments e on e.id = f.enrollment_id
                 join public.parent_students ps on ps.student_id = e.student_id
                where p.receipt_path = name and ps.parent_id = auth.uid())));
-- writes: service role only (no insert/update policy for authenticated)

-- parents already read their payments through fee_plans; expose the new columns the same way (no policy change needed)
