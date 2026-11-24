-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 49 (President 2026-11-22): the Zelle matcher leaves donations alone
--
-- On 2026-11-22 a $300 Zelle with the memo "Donation" was auto-posted as a second November tuition
-- payment (the amount equalled the family's monthly total, and that was all the matcher checked).
-- match_zelle() now leaves an alert for the office (status stays 'pending', with a note) when:
--   1. the memo looks like a gift: donation, sadaqah, zakat, fitr, charity, gift, fundraiser,
--      sponsor, lillah, waqf; or
--   2. the month it would be booked to is already paid for that family (or for that child, when
--      the amount matches one child's plan), so a second payment is never filed as the same month.
-- Everything else is unchanged: known payer + family total, or exactly one child's plan, posts.
-- The office then posts it by hand (Fees → Zelle) or presses Ignore for non-tuition money.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

create or replace function public.match_zelle(p_inbox bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare z record; kids uuid[]; exp numeric; one uuid; mon date; paid int;
begin
  if not (auth.role() = 'service_role' or public.can_edit('fees')) then
    raise exception 'fees permission required';
  end if;
  select * into z from public.zelle_inbox where id = p_inbox;
  if z is null or z.status <> 'pending' then return jsonb_build_object('posted', false, 'reason', 'not pending'); end if;

  -- 1. a gift, not fees
  if coalesce(z.memo, '') ~* '(donat|sadaq|sadqa|zakat|zakah|fitr|charit|gift|fundrais|sponsor|lillah|waqf)' then
    update public.zelle_inbox
       set match_note = 'Memo "' || z.memo || '" looks like a donation, not tuition: press Ignore and record it as a donation. Post it only if it really is fees.'
     where id = p_inbox;
    return jsonb_build_object('posted', false, 'reason', 'donation memo');
  end if;

  kids := public.family_for_payer(z.payer);
  if array_length(kids, 1) is null then
    update public.zelle_inbox set match_note = 'Payer not recognised — pick the family; it will be remembered.' where id = p_inbox;
    return jsonb_build_object('posted', false, 'reason', 'unknown payer');
  end if;

  -- the month post_zelle() would book it to (the payment day, Pacific)
  mon := date_trunc('month', (z.received_at at time zone 'America/Los_Angeles')::date)::date;

  exp := public.expected_monthly(kids);
  if exp > 0 and z.amount = exp then
    -- 2. any of the family's plans already paid for that month: do not file a second one there
    select count(*) into paid
      from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
     where e.status = 'active' and f.status = 'active' and e.student_id = any(kids)
       and exists (select 1 from public.payments p where p.fee_plan_id = f.id and p.payment_method <> 'waived'
                    and coalesce(p.period_month, date_trunc('month', p.payment_date)::date) = mon);
    if paid > 0 then
      update public.zelle_inbox
         set matched_student_ids = kids,
             match_note = to_char(mon, 'FMMonth YYYY') || ' is already paid for this family: is this next month''s fees, a donation or something else? Post or Ignore by hand.'
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
             match_note = to_char(mon, 'FMMonth YYYY') || ' is already paid for this child: is this next month''s fees, a donation or something else? Post or Ignore by hand.'
       where id = p_inbox;
      return jsonb_build_object('posted', false, 'reason', 'month already paid');
    end if;
    return public.post_zelle(p_inbox, array[one], 'auto-matched: ' || z.payer || ' = one child''s plan $' || z.amount::text);
  end if;

  update public.zelle_inbox
     set matched_student_ids = kids,
         match_note = 'Amount $' || z.amount::text || ' differs from the family''s monthly $' || exp::text || ' — confirm which plan(s) it covers.'
   where id = p_inbox;
  return jsonb_build_object('posted', false, 'reason', 'amount mismatch', 'expected', exp);
end; $$;

grant execute on function public.match_zelle(bigint) to authenticated;

-- check: the new rules are in place
select 'match_zelle knows donations' as item,
       case when pg_get_functiondef('public.match_zelle(bigint)'::regprocedure) like '%donation memo%' then 'yes' else 'NO' end as value
union all
select 'match_zelle checks a paid month',
       case when pg_get_functiondef('public.match_zelle(bigint)'::regprocedure) like '%month already paid%' then 'yes' else 'NO' end;
