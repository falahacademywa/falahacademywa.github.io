-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 18: digital admission forms
-- The paper Allergy, Medical and Photo/Media Consent forms become portal
-- forms that parents fill in (and can update) and admins can view/edit.
-- (President's decisions 2026-09-28: new families fill them in the portal,
-- families without a scanned form are reminded on login, parents may change
-- medical answers freely, admins are alerted at once — by email too when the
-- change is safety-relevant; Allergy and Medical are separate forms;
-- immunizations stay a scanned certificate only.)
--
-- 1. medical_info gains the form's fields, per-form signature, review flag
-- 2. media_consent: parents may write their own child's row; review flag
-- 3. audit trail for both tables (same pattern as payments_audit)
-- 4. notify_admins(): in-app notification for every admin, optional
--    immediate e-mail through Brevo via pg_net (key from Vault; falls back to
--    the twice-daily GitHub dispatcher when the key is not set)
-- 5. triggers: parent edits -> admin notification (urgent = e-mail now)
--
-- ONE-TIME SETUP (dev and prod), for the immediate e-mail only:
--   select vault.create_secret('<BREVO_API_KEY value>', 'brevo_api_key');
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 1. medical_info: form fields ----------
alter table public.medical_info
  add column if not exists has_allergies             boolean,
  add column if not exists allergy_food              text,
  add column if not exists allergy_medication        text,
  add column if not exists allergy_other             text,
  add column if not exists allergy_reaction          text,   -- reaction + necessary treatment
  add column if not exists dietary_restrictions      text,
  add column if not exists emergency_medication      text,   -- inhaler / EpiPen details
  add column if not exists emergency_care_authorized boolean,
  add column if not exists allergy_signed_by         text,
  add column if not exists allergy_signed_date       date,
  add column if not exists medical_signed_by         text,
  add column if not exists medical_signed_date       date,
  add column if not exists updated_by                uuid references public.profiles,
  add column if not exists updated_at                timestamptz not null default now(),
  add column if not exists reviewed_at               timestamptz,
  add column if not exists reviewed_by               uuid references public.profiles;

alter table public.media_consent
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles;

-- parents already read+write medical_info (mi_parent_write, phase 1);
-- give them the same on their child's media consent row
drop policy if exists mc_parent_write on public.media_consent;
create policy mc_parent_write on public.media_consent for all
  using (public.is_admin() or public.is_my_child(student_id))
  with check (public.is_admin() or public.is_my_child(student_id));

-- ---------- touch: updated_at / updated_by + legacy "allergies" summary ----------
create or replace function public.medical_info_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- an admin saving the form has seen it: stamp the review with the same clock
  -- as updated_at so the "updated by parent — review" flag does not trip
  if public.is_admin() then new.reviewed_at := now(); new.reviewed_by := auth.uid(); end if;
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
drop trigger if exists medical_info_touch on public.medical_info;
create trigger medical_info_touch before insert or update on public.medical_info
  for each row execute function public.medical_info_touch();

-- same rule for the consent row (replaces the phase-17 touch function)
create or replace function public.media_consent_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if public.is_admin() then new.reviewed_at := now(); new.reviewed_by := auth.uid(); end if;
  return new;
end; $$;
drop trigger if exists media_consent_touch on public.media_consent;
create trigger media_consent_touch before insert or update on public.media_consent
  for each row execute function public.media_consent_touch();

-- rows last saved by the office (or by a script) count as reviewed
update public.medical_info m set reviewed_at = m.updated_at
where (m.reviewed_at is null or m.reviewed_at < m.updated_at)
  and (m.updated_by is null or exists (select 1 from public.profiles p where p.id = m.updated_by and p.role = 'admin'));
update public.media_consent c set reviewed_at = c.updated_at
where (c.reviewed_at is null or c.reviewed_at < c.updated_at)
  and (c.updated_by is null or exists (select 1 from public.profiles p where p.id = c.updated_by and p.role = 'admin'));

-- ---------- 3. audit trail (insert/update/delete) ----------
create or replace function public.row_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action, entity, entity_id, new_value)
    values (auth.uid(), 'insert_' || tg_table_name, tg_table_name, new.student_id::text, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), 'update_' || tg_table_name, tg_table_name, new.student_id::text, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (actor, action, entity, entity_id, old_value)
    values (auth.uid(), 'delete_' || tg_table_name, tg_table_name, old.student_id::text, to_jsonb(old));
    return old;
  end if;
end; $$;
drop trigger if exists medical_info_audit on public.medical_info;
create trigger medical_info_audit after insert or update or delete on public.medical_info
  for each row execute function public.row_audit();
drop trigger if exists media_consent_audit on public.media_consent;
create trigger media_consent_audit after insert or update or delete on public.media_consent
  for each row execute function public.row_audit();

-- ---------- 4. immediate e-mail (Brevo via pg_net, key in Vault) ----------
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not enabled (%): immediate e-mail unavailable, daily dispatcher still works', sqlerrm;
end $$;

create or replace function public.email_now(p_to text, p_name text, p_subject text, p_message text)
returns boolean language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if p_to is null or p_to like '%test.local%' then return false; end if;
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'brevo_api_key' limit 1;
  exception when others then k := null;
  end;
  if k is null then return false; end if;
  perform net.http_post(
    url     := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object('api-key', k, 'Content-Type', 'application/json', 'accept', 'application/json'),
    body    := jsonb_build_object(
      'sender', jsonb_build_object('name', 'Falah Academy', 'email', 'falahacademywa@gmail.com'),
      'to', jsonb_build_array(jsonb_build_object('email', p_to, 'name', coalesce(p_name, 'Falah Academy'))),
      'subject', 'Falah Academy: ' || p_subject,
      'htmlContent', '<p>Assalamu Alaikum ' || coalesce(p_name, '') || ',</p><p>' || p_message ||
        '</p><p>Details: <a href="https://falahacademywa.org/platform/">Family Portal</a></p><p>— Falah Academy</p>'));
  return true;
exception when others then
  return false;
end; $$;

-- every admin gets an in-app notification; with p_email_now the e-mail goes
-- out immediately and the row is marked emailed so the daily job skips it
create or replace function public.notify_admins(
  p_title text, p_message text, p_priority text, p_link text, p_email_now boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a record; nid bigint;
begin
  for a in select id, email, full_name from public.profiles where role = 'admin' loop
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    values (a.id, p_title, p_message, p_priority, p_link) returning id into nid;
    if p_email_now and public.email_now(a.email, a.full_name, p_title, p_message) then
      update public.notifications set emailed = true where id = nid;
    end if;
  end loop;
end; $$;

-- ---------- 5. parent edits -> admin alerts ----------
create or replace function public.trg_medical_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare sname text; who text; urgent_now boolean; urgent_changed boolean; any_changed boolean;
begin
  if public.is_admin() then return new; end if;   -- the office editing its own records
  select first_name || ' ' || last_name into sname from public.students where id = new.student_id;
  select full_name into who from public.profiles where id = auth.uid();
  -- safety-relevant content now on file?
  urgent_now := coalesce(new.has_allergies, false)
    or nullif(btrim(coalesce(new.emergency_medication, '')), '') is not null
    or nullif(btrim(coalesce(new.medical_conditions, '')), '') is not null
    or nullif(btrim(coalesce(new.medications, '')), '') is not null;
  if tg_op = 'INSERT' then
    urgent_changed := urgent_now; any_changed := true;
  else
    urgent_changed := urgent_now and (
      row(new.has_allergies, new.allergy_food, new.allergy_medication, new.allergy_other, new.allergy_reaction,
          new.medical_conditions, new.medications, new.emergency_medication)
      is distinct from
      row(old.has_allergies, old.allergy_food, old.allergy_medication, old.allergy_other, old.allergy_reaction,
          old.medical_conditions, old.medications, old.emergency_medication));
    any_changed := to_jsonb(new) - 'updated_at' - 'updated_by' - 'reviewed_at' - 'reviewed_by' - 'allergies'
      is distinct from to_jsonb(old) - 'updated_at' - 'updated_by' - 'reviewed_at' - 'reviewed_by' - 'allergies';
  end if;
  if not any_changed then return new; end if;
  perform public.notify_admins(
    case when urgent_changed then '⚠ Medical/allergy change for ' || sname else 'Health form updated for ' || sname end,
    coalesce(who, 'A parent') || ' updated ' || sname || '''s ' ||
      case when urgent_changed
        then 'health information and it now lists an allergy, medical condition or medication. Please review it in the Student Profile.'
        else 'allergy/medical form in the Family Portal.' end,
    case when urgent_changed then 'action' else 'important' end,
    '/admin/students/' || new.student_id, urgent_changed);
  return new;
end; $$;
drop trigger if exists medical_info_notify on public.medical_info;
create trigger medical_info_notify after insert or update on public.medical_info
  for each row execute function public.trg_medical_notify();

create or replace function public.trg_consent_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare sname text; who text; pub_before boolean; pub_after boolean;
begin
  if public.is_admin() then return new; end if;
  select first_name || ' ' || last_name into sname from public.students where id = new.student_id;
  select full_name into who from public.profiles where id = auth.uid();
  pub_after := coalesce(new.website_print, false) and coalesce(new.social_media, false) and coalesce(new.external_media, false);
  pub_before := tg_op = 'UPDATE' and coalesce(old.website_print, false) and coalesce(old.social_media, false) and coalesce(old.external_media, false);
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' - 'updated_by' - 'reviewed_at' - 'reviewed_by'
     is not distinct from to_jsonb(old) - 'updated_at' - 'updated_by' - 'reviewed_at' - 'reviewed_by' then
    return new;
  end if;
  perform public.notify_admins(
    'Media consent ' || case when tg_op = 'INSERT' then 'submitted' else 'changed' end || ' for ' || sname,
    coalesce(who, 'A parent') || ' ' || case when tg_op = 'INSERT' then 'submitted' else 'changed' end ||
      ' the photo/video consent for ' || sname || '. Public photos are now ' ||
      case when pub_after then 'ALLOWED' else 'NOT allowed' end || '.' ||
      case when pub_before and not pub_after then ' Consent was withdrawn — stop using existing public photos.' else '' end,
    case when pub_before and not pub_after then 'action' else 'important' end,
    '/admin/students/' || new.student_id, pub_before and not pub_after);
  return new;
end; $$;
drop trigger if exists media_consent_notify on public.media_consent;
create trigger media_consent_notify after insert or update on public.media_consent
  for each row execute function public.trg_consent_notify();
