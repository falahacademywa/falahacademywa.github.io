-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 21: Zelle receipts posted automatically
-- Bank of America e-mails the school Gmail one alert per Zelle received
-- ("<payer> sent you $300.00", memo, date). google-apps-script/zelle-fees-sync.gs
-- reads those alerts hourly and inserts one zelle_inbox row per alert (deduped
-- by Gmail message id), then calls match_zelle():
--   * payer known (known_payers) or exactly one family's guardian, AND the
--     amount equals that family's monthly total  -> payment(s) posted, done
--   * anything else                               -> stays 'pending' for the
--     office to match on Admin -> Fees ("Zelle received — needs a match")
-- Posting by hand from that list teaches known_payers, so the same sender
-- posts automatically next month. Money in only; nothing here moves money.
-- President's decisions 2026-09-28: no parent alert on any payment (manual
-- or automatic); hourly.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- no "payment received" notification for parents any more (manual and automatic alike)
drop trigger if exists payment_notify on public.payments;

create table if not exists public.zelle_inbox (
  id                  bigserial primary key,
  gmail_id            text unique not null,
  received_at         timestamptz not null,
  payer               text not null,
  amount              numeric not null,
  memo                text,
  status              text not null default 'pending' check (status in ('pending', 'posted', 'ignored')),
  matched_student_ids uuid[] not null default '{}',   -- suggestion (pending) or what was posted
  match_note          text,
  posted_payment_ids  bigint[] not null default '{}',
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  resolved_by         uuid references public.profiles
);
create table if not exists public.known_payers (
  payer_key   text primary key,          -- normalised name
  payer       text not null,             -- as it appears on the alert
  student_ids uuid[] not null,
  created_by  uuid references public.profiles,
  created_at  timestamptz not null default now()
);
alter table public.zelle_inbox enable row level security;
alter table public.known_payers enable row level security;
drop policy if exists zi_admin on public.zelle_inbox;
create policy zi_admin on public.zelle_inbox for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists zi_staff_view on public.zelle_inbox;
create policy zi_staff_view on public.zelle_inbox for select using (public.can_view('fees'));
drop policy if exists zi_staff_edit on public.zelle_inbox;
create policy zi_staff_edit on public.zelle_inbox for all using (public.can_edit('fees')) with check (public.can_edit('fees'));
drop policy if exists kp_admin on public.known_payers;
create policy kp_admin on public.known_payers for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists kp_staff on public.known_payers;
create policy kp_staff on public.known_payers for all using (public.can_edit('fees')) with check (public.can_edit('fees'));
grant select, insert, update, delete on public.zelle_inbox, public.known_payers to authenticated;
grant usage, select on sequence public.zelle_inbox_id_seq to authenticated;

-- "Kathra  Ahmed" / "kathra ahmed" / "Ahmed, Kathra" -> one key
create or replace function public.payer_key(p text)
returns text language sql immutable as $$
  select array_to_string((select array_agg(w order by w) from unnest(regexp_split_to_array(
           lower(regexp_replace(coalesce(p, ''), '[^A-Za-z ]+', ' ', 'g')), '\s+')) as w where w <> ''), ' ')
$$;

-- students whose fees this payer is known or likely to pay
create or replace function public.family_for_payer(p_payer text)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare ids uuid[]; k text := public.payer_key(p_payer);
begin
  select student_ids into ids from public.known_payers where payer_key = k;
  if ids is not null then return ids; end if;
  -- guardians registry (name as written on the forms) and portal accounts
  select array_agg(distinct s.id) into ids
  from public.students s
  join public.enrollments e on e.student_id = s.id and e.status = 'active'
  where not s.archived and (
    exists (select 1 from public.guardians g where g.student_id = s.id and public.payer_key(g.name) = k)
    or exists (select 1 from public.parent_students ps join public.profiles p on p.id = ps.parent_id
               where ps.student_id = s.id and public.payer_key(p.full_name) = k));
  return coalesce(ids, '{}');
end; $$;

create or replace function public.expected_monthly(p_students uuid[])
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(f.total_amount), 0)
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
  where e.status = 'active' and f.status = 'active' and f.billing_frequency = 'monthly'
    and e.student_id = any(p_students)
$$;

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

-- Called by the Gmail script after inserting an alert. Posts when confident, else leaves it pending.
create or replace function public.match_zelle(p_inbox bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare z record; kids uuid[]; exp numeric; one uuid;
begin
  if not (auth.role() = 'service_role' or public.can_edit('fees')) then
    raise exception 'fees permission required';
  end if;
  select * into z from public.zelle_inbox where id = p_inbox;
  if z is null or z.status <> 'pending' then return jsonb_build_object('posted', false, 'reason', 'not pending'); end if;
  kids := public.family_for_payer(z.payer);
  if array_length(kids, 1) is null then
    update public.zelle_inbox set match_note = 'Payer not recognised — pick the family; it will be remembered.' where id = p_inbox;
    return jsonb_build_object('posted', false, 'reason', 'unknown payer');
  end if;
  exp := public.expected_monthly(kids);
  if exp > 0 and z.amount = exp then
    return public.post_zelle(p_inbox, kids, 'auto-matched: ' || z.payer || ' = family total $' || exp::text);
  end if;
  -- one child of that family whose own plan equals the amount?
  select e.student_id into one
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
  where e.status = 'active' and f.status = 'active' and e.student_id = any(kids) and f.total_amount = z.amount
  limit 2;
  if one is not null and (select count(*) from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
       where e.status = 'active' and f.status = 'active' and e.student_id = any(kids) and f.total_amount = z.amount) = 1 then
    return public.post_zelle(p_inbox, array[one], 'auto-matched: ' || z.payer || ' = one child''s plan $' || z.amount::text);
  end if;
  update public.zelle_inbox
     set matched_student_ids = kids,
         match_note = 'Amount $' || z.amount::text || ' differs from the family''s monthly $' || exp::text || ' — confirm which plan(s) it covers.'
   where id = p_inbox;
  return jsonb_build_object('posted', false, 'reason', 'amount mismatch', 'expected', exp);
end; $$;

grant execute on function public.post_zelle(bigint, uuid[], text) to authenticated;
grant execute on function public.match_zelle(bigint) to authenticated;
