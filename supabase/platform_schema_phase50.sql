-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 50 (President 2026-11-23): what a parent changed, for the office to review
--
-- The Students menu counted forms "updated by parent — review", but nobody could see WHAT had changed.
--   1. form_changes(student): every change to the student's health form (allergy + medical) and
--      photo-consent form since it was last reviewed: who, when, and each field old -> new, read from
--      the audit trail (phase 18). For full admins and staff with the Health & consent permission.
--   2. form_mark_reviewed(student, form): marks it reviewed (now, by you).
--   3. A review on its own is no longer a "change": the touch triggers keep updated_at / updated_by
--      when only reviewed_at / reviewed_by change (before, a staff review could leave the form flagged).
--      A form saved by a staff member with the Health & consent edit permission counts as reviewed,
--      as it already did for full admins.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

create or replace function public.medical_info_touch()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'reviewed_at' - 'reviewed_by' - 'updated_at' - 'updated_by')
                        = (to_jsonb(old) - 'reviewed_at' - 'reviewed_by' - 'updated_at' - 'updated_by') then
    new.updated_at := old.updated_at; new.updated_by := old.updated_by;   -- only a review
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- the office saving the form has seen it
  if public.is_admin() or coalesce(public.can_edit('health'), false) then new.reviewed_at := now(); new.reviewed_by := auth.uid(); end if;
  -- keep the original free-text column meaningful for older views/exports
  if new.has_allergies is true then
    new.allergies := nullif(concat_ws('; ',
      nullif('Food: ' || nullif(btrim(coalesce(new.allergy_food, '')), ''), 'Food: '),
      nullif('Medication: ' || nullif(btrim(coalesce(new.allergy_medication, '')), ''), 'Medication: '),
      nullif('Other: ' || nullif(btrim(coalesce(new.allergy_other, '')), ''), 'Other: ')), '');
  elsif new.has_allergies is false then
    new.allergies := 'None';
  end if;
  return new;
end; $$;

create or replace function public.media_consent_touch()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'reviewed_at' - 'reviewed_by' - 'updated_at' - 'updated_by')
                        = (to_jsonb(old) - 'reviewed_at' - 'reviewed_by' - 'updated_at' - 'updated_by') then
    new.updated_at := old.updated_at; new.updated_by := old.updated_by;
    return new;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if public.is_admin() or coalesce(public.can_edit('health'), false) then new.reviewed_at := now(); new.reviewed_by := auth.uid(); end if;
  return new;
end; $$;

-- every change since the last review, oldest first; each row lists only the fields that changed
create or replace function public.form_changes(p_student uuid)
returns table (form text, changed_at timestamptz, changed_by text, changed_by_role text, kind text, changes jsonb)
language sql stable security definer set search_path = public as $$
  with since as (
    select 'medical_info'::text as t, (select m.reviewed_at from public.medical_info m where m.student_id = p_student) as r
    union all
    select 'media_consent', (select c.reviewed_at from public.media_consent c where c.student_id = p_student)
  ), rows as (
    select a.entity, a.at, a.actor, a.action, coalesce(a.old_value, '{}'::jsonb) as o, coalesce(a.new_value, '{}'::jsonb) as n
      from public.audit_log a join since s on s.t = a.entity
     where a.entity_id = p_student::text and a.at > coalesce(s.r, '-infinity'::timestamptz)
  ), diffs as (
    select r.*, (select coalesce(jsonb_agg(jsonb_build_object('field', k, 'old', r.o -> k, 'new', r.n -> k) order by k), '[]'::jsonb)
                   from jsonb_object_keys(r.o || r.n) as k
                  where k <> all (array['updated_at', 'updated_by', 'reviewed_at', 'reviewed_by', 'student_id', 'allergies'])
                    and (r.o -> k) is distinct from (r.n -> k)) as ch
      from rows r
  )
  select case d.entity when 'media_consent' then 'consent' else 'medical' end,
         d.at, coalesce(nullif(btrim(p.full_name), ''), 'Someone'), coalesce(p.role, 'system'), split_part(d.action, '_', 1), d.ch
    from diffs d left join public.profiles p on p.id = d.actor
   where jsonb_array_length(d.ch) > 0
     and (public.is_admin() or coalesce(public.can_view('health'), false))
   order by d.at;
$$;
revoke execute on function public.form_changes(uuid) from public, anon;
grant execute on function public.form_changes(uuid) to authenticated;

create or replace function public.form_mark_reviewed(p_student uuid, p_form text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or coalesce(public.can_edit('health'), false)) then raise exception 'health permission required'; end if;
  if p_form in ('medical', 'allergy') then
    update public.medical_info set reviewed_at = now(), reviewed_by = auth.uid() where student_id = p_student;
  elsif p_form = 'consent' then
    update public.media_consent set reviewed_at = now(), reviewed_by = auth.uid() where student_id = p_student;
  else
    raise exception 'unknown form %', p_form;
  end if;
end; $$;
revoke execute on function public.form_mark_reviewed(uuid, text) from public, anon;
grant execute on function public.form_mark_reviewed(uuid, text) to authenticated;

-- check
select 'form_changes' as item, case when to_regprocedure('public.form_changes(uuid)') is not null then 'yes' else 'NO' end as value
union all select 'form_mark_reviewed', case when to_regprocedure('public.form_mark_reviewed(uuid,text)') is not null then 'yes' else 'NO' end
union all select 'forms waiting for review',
  ((select count(*) from public.medical_info where updated_at > coalesce(reviewed_at, '-infinity'::timestamptz))
 + (select count(*) from public.media_consent where updated_at > coalesce(reviewed_at, '-infinity'::timestamptz)))::text;
