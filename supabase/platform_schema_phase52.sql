-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 52 (President 2026-11-26): Zelle -> fees first, then donors
--
-- Every Zelle alert (zelle-fees-sync.gs, hourly) goes through match_zelle():
--   1. A memo that looks like a gift (donation, sadaqah, zakat, ...) is never fees (phase 49):
--      a remembered donor -> recorded as their donation; otherwise it waits for the President.
--   2. FEES FIRST: a sender who is a known family -> tuition, exactly as before (posted when
--      certain, otherwise waiting: month already paid, amount differs).
--   3. THEN DONORS: a sender who is not a family but is a remembered donor (or the one donor with
--      exactly that name) -> recorded as a one-time Zelle donation under that donor, and the full
--      admins get an alert (never copied to staff).
--   4. Otherwise it waits on Admin -> Fees, "Zelle received — needs a match": post it to students,
--      or (full admins) "Donation…": an existing donor, a new donor, or an anonymous profile
--      ("Anonymous donor 1", 2, ...). The sender is remembered either way.
-- New: zelle_inbox.status 'donation'; donations.zelle_inbox_id; donor_payers (sender -> donor,
-- full admins only); donor_for_payer(); record_zelle_donation(). Ignored alerts (e.g. the $300
-- of 2026-11-22) can still be recorded as a donation.
-- Needs phase 51 (donors). Run in dev AND prod. Re-runnable.
-- ================================================================

alter table public.zelle_inbox drop constraint if exists zelle_inbox_status_check;
alter table public.zelle_inbox add constraint zelle_inbox_status_check
  check (status in ('pending', 'posted', 'ignored', 'donation'));

alter table public.donations add column if not exists zelle_inbox_id bigint unique
  references public.zelle_inbox (id) on delete set null;

-- Zelle sender -> donor (like known_payers for families). Full admins only.
create table if not exists public.donor_payers (
  payer_key   text primary key,               -- payer_key(): lower case, words sorted
  payer       text not null,                  -- as written on the alert
  donor_id    uuid not null references public.donors (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.donor_payers enable row level security;
drop policy if exists donor_payers_admin on public.donor_payers;
create policy donor_payers_admin on public.donor_payers for all
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.donor_payers from anon;
grant select, insert, update, delete on public.donor_payers to authenticated;

-- The donor a Zelle sender is: remembered, or else the one donor whose name is exactly the sender's.
create or replace function public.donor_for_payer(p_payer text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare k text := public.payer_key(p_payer); d uuid; n int;
begin
  if coalesce(k, '') = '' then return null; end if;
  select donor_id into d from public.donor_payers where payer_key = k;
  if d is not null then return d; end if;
  select count(*), min(id::text)::uuid into n, d from public.donors where public.payer_key(name) = k;
  return case when n = 1 then d else null end;
end; $$;
revoke execute on function public.donor_for_payer(text) from public, anon, authenticated;

-- Record a Zelle alert as a one-time donation. p_donor = an existing donor; or p_new_name = a new
-- donor by that name; or neither = a new anonymous profile. p_remember: future Zelle from the same
-- sender go to this donor by themselves. Full admins (and the Gmail script) only.
create or replace function public.record_zelle_donation(p_inbox bigint, p_donor uuid default null,
                                                        p_new_name text default null, p_remember boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare z record; d uuid := p_donor; gid uuid; nm text; day date; n int;
begin
  if not (auth.role() = 'service_role' or public.is_admin()) then raise exception 'full admins only'; end if;
  select * into z from public.zelle_inbox where id = p_inbox for update;
  if z is null then raise exception 'no such Zelle alert'; end if;
  if z.status not in ('pending', 'ignored') then raise exception 'this Zelle is already %', z.status; end if;
  day := (z.received_at at time zone 'America/Los_Angeles')::date;

  if d is null then
    nm := nullif(btrim(coalesce(p_new_name, '')), '');
    if nm is null then
      select coalesce(max((regexp_match(name, '(\d+)\s*$'))[1]::int), 0) + 1 into n
        from public.donors where name ~* '^anonymous donor \d+\s*$';
      insert into public.donors (name, notes)
      values ('Anonymous donor ' || n,
              'Anonymous profile, made from a Zelle of ' || to_char(day, 'Mon DD, YYYY') || ' sent by "' || z.payer ||
              '". Rename it if the donor becomes known.')
      returning id into d;
    else
      insert into public.donors (name, notes)
      values (nm, 'Made from a Zelle of ' || to_char(day, 'Mon DD, YYYY') || ' sent by "' || z.payer || '".')
      returning id into d;
    end if;
  elsif not exists (select 1 from public.donors where id = d) then
    raise exception 'no such donor';
  end if;

  insert into public.donations (donor_id, amount, status, frequency, method, donated_on, note, zelle_inbox_id)
  values (d, z.amount, 'donated', 'one_time', 'zelle', day,
          'Zelle from "' || z.payer || '"' || coalesce(', memo "' || nullif(btrim(z.memo), '') || '"', ''), p_inbox)
  returning id into gid;

  update public.zelle_inbox
     set status = 'donation', resolved_at = now(), resolved_by = auth.uid(),
         match_note = 'recorded as a donation (Admin → Donors)'
   where id = p_inbox;

  if p_remember then
    insert into public.donor_payers (payer_key, payer, donor_id)
    values (public.payer_key(z.payer), z.payer, d)
    on conflict (payer_key) do update set donor_id = excluded.donor_id, payer = excluded.payer;
  end if;
  return gid;
end; $$;
revoke execute on function public.record_zelle_donation(bigint, uuid, text, boolean) from public, anon;
grant execute on function public.record_zelle_donation(bigint, uuid, text, boolean) to authenticated;

-- automatic route (from match_zelle): record + tell the full admins
create or replace function public.zelle_to_donor(p_inbox bigint, p_donor uuid, p_why text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare z record; nm text;
begin
  select * into z from public.zelle_inbox where id = p_inbox;
  perform public.record_zelle_donation(p_inbox, p_donor, null, true);
  select name into nm from public.donors where id = p_donor;
  perform public.alert_admins('Donation received: $' || trim(to_char(z.amount, 'FM999,999,990.00')),
    z.payer || ' sent it by Zelle' || coalesce(' ("' || nullif(btrim(z.memo), '') || '")', '') ||
    '. Recorded under ' || nm || ' in Admin → Donors.', '/admin/donors/' || p_donor, 'info', true);
  return jsonb_build_object('posted', true, 'donation', true, 'donor', p_donor, 'reason', 'donation recorded: ' || p_why);
end; $$;
revoke execute on function public.zelle_to_donor(bigint, uuid, text) from public, anon, authenticated;

-- the matcher: memo gift -> donor or wait; known family -> fees (unchanged); else known donor; else wait
create or replace function public.match_zelle(p_inbox bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare z record; kids uuid[]; exp numeric; one uuid; mon date; paid int; d uuid;
begin
  if not (auth.role() = 'service_role' or public.can_edit('fees')) then
    raise exception 'fees permission required';
  end if;
  select * into z from public.zelle_inbox where id = p_inbox;
  if z is null or z.status <> 'pending' then return jsonb_build_object('posted', false, 'reason', 'not pending'); end if;
  -- donors are private to full admins: staff running the matcher never touch them
  if auth.role() = 'service_role' or public.is_admin() then d := public.donor_for_payer(z.payer); end if;

  -- 1. a gift by its memo: never fees
  if coalesce(z.memo, '') ~* '(donat|sadaq|sadqa|zakat|zakah|fitr|charit|gift|fundrais|sponsor|lillah|waqf)' then
    if d is not null then return public.zelle_to_donor(p_inbox, d, 'gift memo, known donor'); end if;
    update public.zelle_inbox
       set match_note = 'Memo "' || z.memo || '" looks like a donation, not tuition: press Donation… and pick the donor (or a new or anonymous one). Post it to students only if it really is fees.'
     where id = p_inbox;
    return jsonb_build_object('posted', false, 'reason', 'donation memo');
  end if;

  -- 2. fees first
  kids := public.family_for_payer(z.payer);
  if array_length(kids, 1) is null then
    -- 3. then donors
    if d is not null then return public.zelle_to_donor(p_inbox, d, 'known donor'); end if;
    update public.zelle_inbox
       set match_note = 'Sender not recognised as a family or a donor: tick the student(s) for fees, or press Donation…. Either way the sender is remembered.'
     where id = p_inbox;
    return jsonb_build_object('posted', false, 'reason', 'unknown payer');
  end if;

  -- the month post_zelle() would book it to (the payment day, Pacific)
  mon := date_trunc('month', (z.received_at at time zone 'America/Los_Angeles')::date)::date;

  exp := public.expected_monthly(kids);
  if exp > 0 and z.amount = exp then
    -- any of the family's plans already paid for that month: do not file a second one there
    select count(*) into paid
      from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
     where e.status = 'active' and f.status = 'active' and e.student_id = any(kids)
       and exists (select 1 from public.payments p where p.fee_plan_id = f.id and p.payment_method <> 'waived'
                    and coalesce(p.period_month, date_trunc('month', p.payment_date)::date) = mon);
    if paid > 0 then
      update public.zelle_inbox
         set matched_student_ids = kids,
             match_note = to_char(mon, 'FMMonth YYYY') || ' is already paid for this family: next month''s fees (post), a donation (Donation…) or something else (ignore)?'
       where id = p_inbox;
      return jsonb_build_object('posted', false, 'reason', 'month already paid');
    end if;
    return public.post_zelle(p_inbox, kids, 'auto-matched: ' || z.payer || ' = family total $' || exp::text);
  end if;

  -- one child of that family whose own plan equals the amount?
  select e.student_id into one
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
  where e.status = 'active' and f.status = 'active' and e.student_id = any(kids) and f.total_amount = z.amount
  limit 2;
  if one is not null and (select count(*) from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
       where e.status = 'active' and f.status = 'active' and e.student_id = any(kids) and f.total_amount = z.amount) = 1 then
    if exists (select 1 from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
                 join public.payments p on p.fee_plan_id = f.id
                where e.status = 'active' and f.status = 'active' and e.student_id = one and p.payment_method <> 'waived'
                  and coalesce(p.period_month, date_trunc('month', p.payment_date)::date) = mon) then
      update public.zelle_inbox
         set matched_student_ids = array[one],
             match_note = to_char(mon, 'FMMonth YYYY') || ' is already paid for this child: next month''s fees (post), a donation (Donation…) or something else (ignore)?'
       where id = p_inbox;
      return jsonb_build_object('posted', false, 'reason', 'month already paid');
    end if;
    return public.post_zelle(p_inbox, array[one], 'auto-matched: ' || z.payer || ' = one child''s plan $' || z.amount::text);
  end if;

  update public.zelle_inbox
     set matched_student_ids = kids,
         match_note = 'Amount $' || z.amount::text || ' differs from the family''s monthly $' || exp::text || ': confirm which plan(s) it covers, or press Donation… if it is a gift.'
   where id = p_inbox;
  return jsonb_build_object('posted', false, 'reason', 'amount mismatch', 'expected', exp);
end; $$;
grant execute on function public.match_zelle(bigint) to authenticated;

-- check: 4 rows, all "yes"
select 'status donation allowed' as item,
       case when pg_get_constraintdef((select oid from pg_constraint where conname = 'zelle_inbox_status_check')) like '%donation%' then 'yes' else 'NO' end as value
union all select 'donor_payers table', case when to_regclass('public.donor_payers') is not null then 'yes' else 'NO' end
union all select 'record_zelle_donation', case when to_regprocedure('public.record_zelle_donation(bigint,uuid,text,boolean)') is not null then 'yes' else 'NO' end
union all select 'match_zelle routes to donors',
       case when pg_get_functiondef('public.match_zelle(bigint)'::regprocedure) like '%zelle_to_donor%' then 'yes' else 'NO' end;
