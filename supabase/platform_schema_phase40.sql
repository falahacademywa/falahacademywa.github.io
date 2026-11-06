-- Phase 40 (2026-11-05, President): parent-meeting booking with a private code per family.
-- Run in dev AND prod, after phase 39. Safe to run more than once.
--
-- Until now a family was identified by the child's first name plus a guardian phone number. Class
-- WhatsApp groups show parents' numbers, so another parent could look up, move or cancel a
-- family's meeting. From now on each family (per class) has a 6-character code printed on its own
-- invitation slip (scripts/make-ptm-invites.py; the QR fills it in). The booking page asks for the
-- code and the child's first name. The phone number is optional and only tells the office how to
-- reach the parent. Admin -> Parent meetings shows every family's code, so the office can read it
-- out to a parent who lost the slip. Wrong tries are still throttled per class (phase 39).

create table if not exists public.ptm_codes (
  class_id  int  not null references public.ptm_classes on delete cascade,
  family_no int  not null,
  code      text not null unique,
  created_at timestamptz not null default now(),
  primary key (class_id, family_no)
);
alter table public.ptm_codes enable row level security;
drop policy if exists ptm_codes_view on public.ptm_codes;
create policy ptm_codes_view on public.ptm_codes for select using (public.can_view('meetings'));
grant select on public.ptm_codes to authenticated;
grant all on public.ptm_codes to service_role;

-- 6 characters without look-alikes (no 0/O, 1/I/L, 2/Z, 5/S, 8/B)
create or replace function public.ptm_new_code()
returns text language plpgsql volatile set search_path = public as $$
declare abc text := 'ACDEFGHJKMNPQRTUVWXY34679'; c text;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.ptm_codes where code = c);
  end loop;
  return c;
end; $$;
revoke all on function public.ptm_new_code() from public, anon, authenticated;

create or replace function public.ptm_ensure_code(cid int, fam int)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select code into c from public.ptm_codes where class_id = cid and family_no = fam;
  if c is null then
    insert into public.ptm_codes (class_id, family_no, code) values (cid, fam, public.ptm_new_code())
    on conflict (class_id, family_no) do nothing;
    select code into c from public.ptm_codes where class_id = cid and family_no = fam;
  end if;
  return c;
end; $$;
revoke all on function public.ptm_ensure_code(int, int) from public, anon, authenticated;

-- every family that has a child in a class gets a code (new invites, sibling grouping)
create or replace function public.trg_ptm_students_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ptm_ensure_code(new.class_id, new.family_no);
  return new;
end; $$;
drop trigger if exists ptm_students_code on public.ptm_students;
create trigger ptm_students_code after insert or update of family_no on public.ptm_students
  for each row execute function public.trg_ptm_students_code();
select public.ptm_ensure_code(class_id, family_no) from (select distinct class_id, family_no from public.ptm_students) f;

-- the family behind a code (+ the child's first name as a second check)
create or replace function public.ptm_family_of(cid int, p_code text, p_child text)
returns int language sql stable security definer set search_path = public as $$
  select fc.family_no from public.ptm_codes fc
   where fc.class_id = cid and fc.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and exists (select 1 from public.ptm_students ps join public.students s on s.id = ps.student_id
                  where ps.class_id = cid and ps.family_no = fc.family_no and ps.invited
                    and lower(btrim(s.first_name)) = lower(split_part(btrim(coalesce(p_child, '')), ' ', 1)))
$$;
revoke all on function public.ptm_family_of(int, text, text) from public, anon, authenticated;

-- the old phone-based look-up and booking are retired
drop function if exists public.ptm_family(text, text, text);
drop function if exists public.ptm_book(text, text, text, text, text);

create or replace function public.ptm_family(p_token text, p_code text, p_child text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cid int; fam int;
begin
  cid := public.ptm_class_of(p_token);
  if cid is null or coalesce(btrim(p_code), '') = '' or coalesce(btrim(p_child), '') = '' then return null; end if;
  if public.ptm_throttled(cid) then return jsonb_build_object('error', 'Too many tries. Please wait 15 minutes or contact the school office.'); end if;
  fam := public.ptm_family_of(cid, p_code, p_child);
  insert into public.ptm_attempts (class_id, ok) values (cid, fam is not null);
  if fam is null then return null; end if;
  return jsonb_build_object(
    'children', (select jsonb_agg(s.first_name order by s.first_name) from public.ptm_students ps
                   join public.students s on s.id = ps.student_id
                  where ps.class_id = cid and ps.family_no = fam and ps.invited),
    'slot', (select public.ptm_hm(b.slot) from public.ptm_bookings b where b.class_id = cid and b.family_no = fam),
    'parent_name', null);
end; $$;
grant execute on function public.ptm_family(text, text, text) to anon, authenticated;

create or replace function public.ptm_book(p_token text, p_code text, p_child text, p_slot text, p_parent text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; e record; fam int; t time; had time; kids text;
begin
  select cl.* into c from public.ptm_classes cl where cl.id = public.ptm_class_of(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into e from public.ptm_events where id = c.event_id;
  if not e.active or (e.book_until is not null and now() >= e.book_until) then
    return jsonb_build_object('ok', false, 'error', 'Booking is closed. Please contact the school office.');
  end if;
  if public.ptm_throttled(c.id) then
    return jsonb_build_object('ok', false, 'error', 'Too many tries. Please wait 15 minutes or contact the school office.');
  end if;
  fam := public.ptm_family_of(c.id, p_code, p_child);
  insert into public.ptm_attempts (class_id, ok) values (c.id, fam is not null);
  if fam is null then
    return jsonb_build_object('ok', false, 'error', 'We could not match that code and first name. Please check the code on your invitation, or contact the office.');
  end if;
  select string_agg(s.first_name, ' & ' order by s.first_name) into kids
    from public.ptm_students ps join public.students s on s.id = ps.student_id
   where ps.class_id = c.id and ps.family_no = fam and ps.invited;
  select slot into had from public.ptm_bookings where class_id = c.id and family_no = fam;

  if p_slot is null then
    delete from public.ptm_bookings where class_id = c.id and family_no = fam;
    if had is not null then
      perform public.ptm_note_admins('Parent meeting cancelled',
        c.name || ': the ' || public.ptm_ampm(had) || ' meeting for ' || kids || ' was cancelled by the parent.');
    end if;
    return jsonb_build_object('ok', true, 'slot', null);
  end if;

  if p_slot !~ '^\s*[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?\s*$' then
    return jsonb_build_object('ok', false, 'error', 'That time is not offered.');
  end if;
  begin
    t := p_slot::time;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'That time is not offered.');
  end;
  if not (t = any (e.slots)) or (t = any (c.closed_slots) and had is distinct from t) then
    return jsonb_build_object('ok', false, 'error', 'That time is not offered.');
  end if;
  perform 1 from public.ptm_classes where id = c.id for update;     -- one booking at a time per class
  if (select count(*) from public.ptm_bookings b where b.class_id = c.id and b.slot = t and b.family_no <> fam) >= c.capacity then
    return jsonb_build_object('ok', false, 'error', 'Sorry, that time was just taken. Please choose another.');
  end if;
  insert into public.ptm_bookings (class_id, family_no, slot, parent_name, phone)
  values (c.id, fam, t, nullif(btrim(p_parent), ''), nullif(btrim(p_phone), ''))
  on conflict (class_id, family_no) do update set slot = excluded.slot,
     parent_name = coalesce(excluded.parent_name, ptm_bookings.parent_name),
     phone = coalesce(excluded.phone, ptm_bookings.phone), booked_at = now();
  if had is distinct from t then
    perform public.ptm_note_admins('Parent meeting ' || case when had is null then 'booked' else 'moved' end,
      c.name || ': ' || kids || ' — ' || public.ptm_ampm(t) || ' on ' || to_char(e.meet_date, 'FMMon FMDD')
      || case when had is null then '' else ' (was ' || public.ptm_ampm(had) || ')' end || '.');
  end if;
  return jsonb_build_object('ok', true, 'slot', public.ptm_hm(t));
end; $$;
grant execute on function public.ptm_book(text, text, text, text, text, text) to anon, authenticated;

-- invitation slips (scripts/make-ptm-invites.py, service key): one row per invited family
create or replace function public.ptm_invite_list(p_event int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ev int := p_event;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_view('meetings') then raise exception 'not allowed'; end if;
  if ev is null then select id into ev from public.ptm_events where active order by meet_date desc limit 1; end if;
  return coalesce((select jsonb_agg(x order by x->>'sort', x->>'children') from (
    select jsonb_build_object('class', c.name, 'sort', c.sort, 'slug', l.slug, 'code', fc.code,
             'children', string_agg(s.first_name, ' & ' order by s.first_name)) x
      from public.ptm_classes c
      join public.ptm_links l on l.class_id = c.id
      join public.ptm_students ps on ps.class_id = c.id and ps.invited
      join public.students s on s.id = ps.student_id
      join public.ptm_codes fc on fc.class_id = c.id and fc.family_no = ps.family_no
     where c.event_id = ev
     group by c.name, c.sort, l.slug, fc.code) y), '[]'::jsonb);
end; $$;
revoke all on function public.ptm_invite_list(int) from public, anon;
grant execute on function public.ptm_invite_list(int) to authenticated, service_role;

select 'phase 40 ok' as result,
  (select count(*) from public.ptm_codes) as codes,
  (select count(distinct (class_id, family_no)) from public.ptm_students) as families,
  (select count(*) from pg_proc where proname = 'ptm_book') as ptm_book_versions;
