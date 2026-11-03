-- Phase 33 (2026-11-02, President, TODO #160): parent-teacher meetings.
--
--   * One event (date, 30-minute slots) with one booking link per class. The link is a
--     stand-alone page of the portal, /platform/#/meet/<token>, not linked from the website.
--   * Parents book without signing in: child's first name + the phone number the school has
--     on file. Siblings in the same class share one family number and one slot; the office
--     can merge families or leave a child out on Admin → Parent meetings.
--   * Teachers see their classes' bookings in the teacher app and post remarks per student
--     (class teacher and Qur'an teacher, one remark each) only after that meeting has ended.
--   * Parents read the remarks on their portal home; the office sees everything.
--   * Staff permission module 'meetings' (view = see, edit = change the invite list, open or
--     close a time per class, add a time to the day, cancel a booking).
--   * 2026-11-03 (President): short links parents can remember — falahacademywa.org/meet/prek,
--     /meet/kg, /meet/grade1 (static redirect pages to /platform/#/meet/<slug>); ptm_links.slug.
--   * No e-mail from this feature (President 2026-11-03): its portal notifications are created
--     with emailed = true, so the twice-daily dispatcher never mails them.
--   * 2026-11-03 (President): 12:30 is a time again, and the office controls the times —
--     each class has its own closed times (ptm_classes.closed_slots); parents never see those.
--
-- Every table is locked to admins / staff with the module; everybody else goes through the
-- security-definer functions below, which do their own checks. Idempotent: safe to re-run.

-- ---------- 1. tables ----------
create table if not exists public.ptm_events (
  id            serial primary key,
  title         text not null,
  meet_date     date not null,
  slot_minutes  int  not null default 30,
  slots         time[] not null,                  -- start times
  quran_minutes int  not null default 5,          -- last minutes of each slot, Qur'an teacher
  book_until    timestamptz,                      -- parents may book/change until then
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.ptm_classes (
  id        serial primary key,
  event_id  int  not null references public.ptm_events on delete cascade,
  name      text not null,                        -- what parents see ("Pre-K", "KG", "Grade 1")
  grade_ids int[] not null,                       -- grades taught together in this class
  capacity  int  not null default 1,              -- meetings per time (tables)
  sort      int  not null default 0,
  unique (event_id, name)
);

-- the secret part of the link, kept apart so no parent/teacher query can ever read it
alter table public.ptm_classes add column if not exists closed_slots time[] not null default '{}';   -- times the office closed for this class

create table if not exists public.ptm_links (
  class_id int primary key references public.ptm_classes on delete cascade,
  token    text not null unique default encode(extensions.gen_random_bytes(9), 'hex')
);
alter table public.ptm_links add column if not exists slug text unique;   -- short name in /meet/<slug> (one class at a time)

create table if not exists public.ptm_students (
  class_id  int  not null references public.ptm_classes on delete cascade,
  student_id uuid not null references public.students on delete cascade,
  family_no int  not null,                        -- siblings in this class share it
  invited   boolean not null default true,
  primary key (class_id, student_id)
);

create table if not exists public.ptm_bookings (
  id          serial primary key,
  class_id    int  not null references public.ptm_classes on delete cascade,
  family_no   int  not null,
  slot        time not null,
  parent_name text,
  phone       text,                               -- as typed by the parent
  booked_at   timestamptz not null default now(),
  unique (class_id, family_no)
);

create table if not exists public.ptm_remarks (
  id          serial primary key,
  class_id    int  not null references public.ptm_classes on delete cascade,
  student_id  uuid not null references public.students on delete cascade,
  kind        text not null check (kind in ('class', 'quran')),
  body        text not null check (length(btrim(body)) > 0),
  author_id   uuid references public.profiles,
  author_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (class_id, student_id, kind)
);

do $$
declare t text;
begin
  foreach t in array array['ptm_events','ptm_classes','ptm_links','ptm_students','ptm_bookings','ptm_remarks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_view', t);
    execute format('drop policy if exists %I on public.%I', t || '_edit', t);
    execute format('create policy %I on public.%I for select using (public.can_view(''meetings''))', t || '_view', t);
    execute format('create policy %I on public.%I for all using (public.can_edit(''meetings'')) with check (public.can_edit(''meetings''))', t || '_edit', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- 2. helpers ----------
-- digits only, last ten (US numbers with or without +1)
create or replace function public.ptm_phone(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- times as text: 'HH24:MI' for the app, '9:30 AM' for messages
create or replace function public.ptm_hm(p time)
returns text language sql immutable as $$ select to_char(date '2000-01-01' + p, 'HH24:MI') $$;
create or replace function public.ptm_ampm(p time)
returns text language sql immutable as $$ select to_char(date '2000-01-01' + p, 'FMHH12:MI AM') $$;

-- the class behind a link: the long token or the short slug ("kg", "KG", " Kg ")
create or replace function public.ptm_class_of(p text)
returns int language sql stable security definer set search_path = public as $$
  select class_id from public.ptm_links where token = btrim(p) or slug = lower(btrim(p)) limit 1
$$;

-- in-app notes only (no e-mail): the dispatcher skips rows already marked emailed
create or replace function public.ptm_note_admins(p_title text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
  select id, p_title, p_message, 'info', '/admin/meetings', true from public.profiles where role = 'admin'
$$;

-- when a slot ends (Pacific)
create or replace function public.ptm_slot_end(p_event int, p_slot time)
returns timestamptz language sql stable security definer set search_path = public as $$
  select ((e.meet_date + p_slot) + make_interval(mins => e.slot_minutes)) at time zone 'America/Los_Angeles'
    from public.ptm_events e where e.id = p_event
$$;

-- (re)build a class's invite list from the active enrollments in its grades; siblings
-- (shared guardian phone/e-mail or shared parent login) get one family number. Children
-- already on the list keep their family number and invited flag (the office's choices).
create or replace function public.ptm_fill_class(p_class int)
returns int language plpgsql security definer set search_path = public as $$
declare c record; changed int; n int;
begin
  -- the office, or the SQL editor / service role (no signed-in caller); never anon or a parent
  if not (public.can_edit('meetings') or coalesce(auth.role(), '') not in ('anon', 'authenticated')) then raise exception 'not allowed'; end if;
  select * into c from public.ptm_classes where id = p_class;
  insert into public.ptm_students (class_id, student_id, family_no)
  select p_class, e.student_id, s.student_no
    from public.enrollments e
    join public.school_years y on y.id = e.school_year_id and y.is_current
    join public.students s on s.id = e.student_id
   where e.status = 'active' and e.grade_id = any (c.grade_ids)
  on conflict do nothing;
  get diagnostics n = row_count;
  -- merge new children into a sibling's family number (lowest wins), repeat until stable
  loop
    with keys as (
      select ps.student_id, 'p' || public.ptm_phone(g.phone) k from public.ptm_students ps
        join public.guardians g on g.student_id = ps.student_id
       where ps.class_id = p_class and length(public.ptm_phone(g.phone)) = 10
      union
      select ps.student_id, 'e' || lower(btrim(g.email)) from public.ptm_students ps
        join public.guardians g on g.student_id = ps.student_id
       where ps.class_id = p_class and nullif(btrim(g.email), '') is not null
      union
      select ps.student_id, 'l' || x.parent_id from public.ptm_students ps
        join public.parent_students x on x.student_id = ps.student_id
       where ps.class_id = p_class),
    best as (
      select a.student_id, min(fb.family_no) fam
        from keys a join keys b on a.k = b.k
        join public.ptm_students fb on fb.class_id = p_class and fb.student_id = b.student_id
       group by a.student_id)
    update public.ptm_students ps set family_no = best.fam
      from best
     where ps.class_id = p_class and ps.student_id = best.student_id and best.fam < ps.family_no
       and not exists (select 1 from public.ptm_bookings b where b.class_id = p_class and b.family_no = ps.family_no);
    get diagnostics changed = row_count;
    exit when changed = 0;
  end loop;
  return n;
end; $$;

-- ---------- 3. parents: the booking page (no sign-in) ----------
-- what the page shows before anyone identifies: class, date, free/taken times (no names)
create or replace function public.ptm_page(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', e.title, 'class', c.name, 'date', e.meet_date, 'minutes', e.slot_minutes,
    'open', e.active and (e.book_until is null or now() < e.book_until),
    'book_until', e.book_until,
    'slots', (select jsonb_agg(jsonb_build_object('time', public.ptm_hm(s),
                'free', (select count(*) from public.ptm_bookings b where b.class_id = c.id and b.slot = s) < c.capacity)
                order by s) from unnest(e.slots) s where not (s = any (c.closed_slots))))
  from public.ptm_links l join public.ptm_classes c on c.id = l.class_id join public.ptm_events e on e.id = c.event_id
  where l.class_id = public.ptm_class_of(p_token)
$$;

-- identify: the child's first name + a phone number on file for that family
create or replace function public.ptm_family(p_token text, p_child text, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid int; fam int; ph text := public.ptm_phone(p_phone); first text := lower(split_part(btrim(coalesce(p_child, '')), ' ', 1));
begin
  if length(ph) < 10 or first = '' then return null; end if;
  cid := public.ptm_class_of(p_token);
  if cid is null then return null; end if;
  select ps.family_no into fam
    from public.ptm_students ps join public.students s on s.id = ps.student_id
   where ps.class_id = cid and ps.invited and lower(btrim(s.first_name)) = first
     and exists (select 1 from public.ptm_students f join public.guardians g on g.student_id = f.student_id
                  where f.class_id = cid and f.family_no = ps.family_no and public.ptm_phone(g.phone) = ph)
   limit 1;
  if fam is null then return null; end if;
  return jsonb_build_object(
    'children', (select jsonb_agg(s.first_name order by s.first_name) from public.ptm_students ps
                   join public.students s on s.id = ps.student_id
                  where ps.class_id = cid and ps.family_no = fam and ps.invited),
    'slot', (select public.ptm_hm(b.slot) from public.ptm_bookings b where b.class_id = cid and b.family_no = fam),
    'parent_name', (select b.parent_name from public.ptm_bookings b where b.class_id = cid and b.family_no = fam));
end; $$;

-- book, change (another time) or cancel (p_slot null)
create or replace function public.ptm_book(p_token text, p_child text, p_phone text, p_slot text, p_parent text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; e record; fam int; t time; ph text := public.ptm_phone(p_phone);
        first text := lower(split_part(btrim(coalesce(p_child, '')), ' ', 1)); had time; kids text;
begin
  select cl.* into c from public.ptm_classes cl where cl.id = public.ptm_class_of(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  select * into e from public.ptm_events where id = c.event_id;
  if not e.active or (e.book_until is not null and now() >= e.book_until) then
    return jsonb_build_object('ok', false, 'error', 'Booking is closed. Please contact the school office.');
  end if;
  select ps.family_no into fam
    from public.ptm_students ps join public.students s on s.id = ps.student_id
   where ps.class_id = c.id and ps.invited and lower(btrim(s.first_name)) = first and length(ph) = 10
     and exists (select 1 from public.ptm_students f join public.guardians g on g.student_id = f.student_id
                  where f.class_id = c.id and f.family_no = ps.family_no and public.ptm_phone(g.phone) = ph)
   limit 1;
  if fam is null then
    return jsonb_build_object('ok', false, 'error', 'We could not match that name and phone number. Please use the number the school has on file, or contact the office.');
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

  t := p_slot::time;
  if not (t = any (e.slots)) or (t = any (c.closed_slots) and had is distinct from t) then
    return jsonb_build_object('ok', false, 'error', 'That time is not offered.');
  end if;
  perform 1 from public.ptm_classes where id = c.id for update;     -- one booking at a time per class
  if (select count(*) from public.ptm_bookings b where b.class_id = c.id and b.slot = t and b.family_no <> fam) >= c.capacity then
    return jsonb_build_object('ok', false, 'error', 'Sorry, that time was just taken. Please choose another.');
  end if;
  insert into public.ptm_bookings (class_id, family_no, slot, parent_name, phone)
  values (c.id, fam, t, nullif(btrim(p_parent), ''), btrim(p_phone))
  on conflict (class_id, family_no) do update set slot = excluded.slot, parent_name = coalesce(excluded.parent_name, ptm_bookings.parent_name),
     phone = excluded.phone, booked_at = now();
  if had is distinct from t then
    perform public.ptm_note_admins('Parent meeting ' || case when had is null then 'booked' else 'moved' end,
      c.name || ': ' || kids || ' — ' || public.ptm_ampm(t) || ' on ' || to_char(e.meet_date, 'FMMon FMDD')
      || case when had is null then '' else ' (was ' || public.ptm_ampm(had) || ')' end || '.');
  end if;
  return jsonb_build_object('ok', true, 'slot', public.ptm_hm(t));
end; $$;

-- internal helpers: only the functions above use them
revoke all on function public.ptm_class_of(text), public.ptm_note_admins(text, text) from public, anon, authenticated;
revoke all on function public.ptm_page(text), public.ptm_family(text, text, text), public.ptm_book(text, text, text, text, text) from public;
grant execute on function public.ptm_page(text), public.ptm_family(text, text, text), public.ptm_book(text, text, text, text, text) to anon, authenticated;

-- ---------- 4. teachers ----------
-- the caller's roles for a class: 'class' (homeroom) and/or 'quran'
create or replace function public.ptm_my_kinds(p_class int)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct case when tg.role = 'quran' then 'quran' else 'class' end), '{}')
    from public.teachers t
    join public.teacher_grades tg on tg.teacher_id = t.id
    join public.school_years y on y.id = tg.school_year_id and y.is_current
    join public.ptm_classes c on c.id = p_class and tg.grade_id = any (c.grade_ids)
   where t.user_id = auth.uid() and t.app_access and t.active
$$;

-- everything the teacher app shows: my classes in active events, each student with time and remarks
create or replace function public.ptm_teacher_view()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'class_id', c.id, 'class', c.name, 'title', e.title, 'date', e.meet_date, 'minutes', e.slot_minutes,
      'quran_minutes', e.quran_minutes, 'kinds', public.ptm_my_kinds(c.id),
      'last_end', public.ptm_slot_end(e.id, (select max(s) from unnest(e.slots) s)),
      'students', (select coalesce(jsonb_agg(jsonb_build_object(
          'student_id', s.id, 'name', s.first_name || ' ' || s.last_name, 'photo', s.profile_photo_url, 'family_no', ps.family_no,
          'slot', public.ptm_hm(b.slot), 'parent_name', b.parent_name,
          'ends_at', case when b.slot is not null then public.ptm_slot_end(e.id, b.slot) end,
          'remarks', (select coalesce(jsonb_object_agg(r.kind, jsonb_build_object('body', r.body, 'by', r.author_name, 'at', r.updated_at)), '{}')
                        from public.ptm_remarks r where r.class_id = c.id and r.student_id = s.id))
          order by b.slot nulls last, s.first_name), '[]')
        from public.ptm_students ps join public.students s on s.id = ps.student_id
        left join public.ptm_bookings b on b.class_id = c.id and b.family_no = ps.family_no
       where ps.class_id = c.id and ps.invited))
    order by e.meet_date, c.sort), '[]')
  from public.ptm_classes c join public.ptm_events e on e.id = c.event_id
  where e.active and cardinality(public.ptm_my_kinds(c.id)) > 0
$$;

-- post or edit a remark: only a teacher of that class in that role, only after the meeting ended
-- (a child without a booking: after the last meeting of the day)
create or replace function public.ptm_save_remark(p_class int, p_student uuid, p_kind text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e record; b record; ends timestamptz; who text; sname text; first_post boolean;
begin
  if not (p_kind = any (public.ptm_my_kinds(p_class))) then
    return jsonb_build_object('ok', false, 'error', 'You are not a ' || case when p_kind = 'quran' then 'Qur''an' else 'class' end || ' teacher of this class.');
  end if;
  if not exists (select 1 from public.ptm_students where class_id = p_class and student_id = p_student and invited) then
    return jsonb_build_object('ok', false, 'error', 'This student is not on the meeting list.');
  end if;
  select ev.* into e from public.ptm_events ev join public.ptm_classes c on c.event_id = ev.id where c.id = p_class;
  select bk.slot into b from public.ptm_bookings bk join public.ptm_students ps on ps.class_id = bk.class_id and ps.family_no = bk.family_no
   where ps.class_id = p_class and ps.student_id = p_student;
  ends := public.ptm_slot_end(e.id, coalesce(b.slot, (select max(s) from unnest(e.slots) s)));
  if now() < ends then
    return jsonb_build_object('ok', false, 'error', 'Remarks open when the meeting is over (' ||
      to_char(ends at time zone 'America/Los_Angeles', 'FMMon FMDD, FMHH12:MI AM') || ').');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then return jsonb_build_object('ok', false, 'error', 'Write the remarks first.'); end if;
  select coalesce(t.first_name || ' ' || t.last_name, p.full_name) into who
    from public.profiles p left join public.teachers t on t.user_id = p.id where p.id = auth.uid() limit 1;
  first_post := not exists (select 1 from public.ptm_remarks where class_id = p_class and student_id = p_student and kind = p_kind);
  insert into public.ptm_remarks (class_id, student_id, kind, body, author_id, author_name)
  values (p_class, p_student, p_kind, btrim(p_body), auth.uid(), who)
  on conflict (class_id, student_id, kind) do update set body = excluded.body, author_id = excluded.author_id,
     author_name = excluded.author_name, updated_at = now();
  if first_post then
    select first_name into sname from public.students where id = p_student;
    insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
    select ps.parent_id, 'Parent-teacher meeting notes',
      who || ' posted ' || case when p_kind = 'quran' then 'Qur''an ' else '' end || 'notes for ' || sname
      || ' from the meeting on ' || to_char(e.meet_date, 'FMMon FMDD') || '.', 'info', '/parent', true
      from public.parent_students ps where ps.student_id = p_student;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ---------- 5. parents: the portal home card ----------
create or replace function public.ptm_parent_view()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'student_id', ps.student_id, 'class', c.name, 'title', e.title, 'date', e.meet_date, 'minutes', e.slot_minutes,
      'slot', public.ptm_hm(b.slot),
      'remarks', (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'body', r.body, 'by', r.author_name, 'at', r.updated_at)
                    order by r.kind), '[]') from public.ptm_remarks r where r.class_id = c.id and r.student_id = ps.student_id))
    order by e.meet_date desc), '[]')
  from public.ptm_students ps
  join public.ptm_classes c on c.id = ps.class_id
  join public.ptm_events e on e.id = c.event_id
  left join public.ptm_bookings b on b.class_id = c.id and b.family_no = ps.family_no
  where ps.invited and public.is_my_child(ps.student_id)
    and (e.active or exists (select 1 from public.ptm_remarks r where r.class_id = c.id and r.student_id = ps.student_id))
$$;

-- ---------- 6. office: the admin page ----------
create or replace function public.ptm_admin_view(p_event int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ev int := p_event;
begin
  if not public.can_view('meetings') then raise exception 'not allowed'; end if;
  if ev is null then select id into ev from public.ptm_events where active order by meet_date desc limit 1; end if;
  if ev is null then select id into ev from public.ptm_events order by meet_date desc limit 1; end if;
  return (select jsonb_build_object(
    'event', to_jsonb(e) - 'created_at',
    'events', (select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'date', x.meet_date) order by x.meet_date desc) from public.ptm_events x),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'capacity', c.capacity, 'token', l.token, 'slug', l.slug,
        'closed', (select coalesce(jsonb_agg(public.ptm_hm(x)), '[]') from unnest(c.closed_slots) x),
        'students', (select coalesce(jsonb_agg(jsonb_build_object(
            'student_id', s.id, 'name', s.first_name || ' ' || s.last_name, 'grade', en.grade_name,
            'family_no', ps.family_no, 'invited', ps.invited,
            'slot', public.ptm_hm(b.slot), 'parent_name', b.parent_name, 'phone', b.phone, 'booked_at', b.booked_at,
            'remarks', (select coalesce(jsonb_object_agg(r.kind, jsonb_build_object('body', r.body, 'by', r.author_name, 'at', r.updated_at)), '{}')
                          from public.ptm_remarks r where r.class_id = c.id and r.student_id = s.id))
            order by s.first_name), '[]')
          from public.ptm_students ps join public.students s on s.id = ps.student_id
          left join lateral (select en.grade_name from public.enrollments en join public.school_years y on y.id = en.school_year_id and y.is_current
                              where en.student_id = s.id limit 1) en on true
          left join public.ptm_bookings b on b.class_id = c.id and b.family_no = ps.family_no
         where ps.class_id = c.id))
      order by c.sort), '[]')
      from public.ptm_classes c left join public.ptm_links l on l.class_id = c.id where c.event_id = e.id))
    from public.ptm_events e where e.id = ev);
end; $$;

-- invite / leave out a child, or put a child into another child's family (one shared slot)
create or replace function public.ptm_admin_set(p_class int, p_student uuid, p_invited boolean, p_same_as uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare fam int; old int;
begin
  if not public.can_edit('meetings') then raise exception 'not allowed'; end if;
  select family_no into old from public.ptm_students where class_id = p_class and student_id = p_student;
  if p_same_as is not null then
    select family_no into fam from public.ptm_students where class_id = p_class and student_id = p_same_as;
  else
    fam := old;
  end if;
  if fam is distinct from old and exists (select 1 from public.ptm_bookings where class_id = p_class and family_no = old)
     and exists (select 1 from public.ptm_bookings where class_id = p_class and family_no = fam) then
    return jsonb_build_object('ok', false, 'error', 'Both families already booked a time; cancel one booking first.');
  end if;
  if fam is distinct from old then
    -- a booking made by the moved child's old family follows it if it was the only child there
    if not exists (select 1 from public.ptm_students where class_id = p_class and family_no = old and student_id <> p_student) then
      update public.ptm_bookings set family_no = fam where class_id = p_class and family_no = old;
    end if;
  end if;
  update public.ptm_students set invited = p_invited, family_no = fam where class_id = p_class and student_id = p_student;
  return jsonb_build_object('ok', true);
end; $$;

-- open or close one time for one class (bookings already made at that time stay)
create or replace function public.ptm_admin_slot(p_class int, p_slot text, p_open boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit('meetings') then raise exception 'not allowed'; end if;
  update public.ptm_classes set closed_slots = case when p_open
      then array_remove(closed_slots, p_slot::time)
      else (select array_agg(distinct x order by x) from unnest(closed_slots || p_slot::time) x) end
   where id = p_class;
  return jsonb_build_object('ok', true);
end; $$;

-- add a start time to the day (every class gets it, open)
create or replace function public.ptm_admin_add_time(p_event int, p_slot text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t time;
begin
  if not public.can_edit('meetings') then raise exception 'not allowed'; end if;
  begin t := p_slot::time; exception when others then
    return jsonb_build_object('ok', false, 'error', 'Type the time as 12:30 or 2:00 PM.'); end;
  if t < '07:00' or t > '18:00' then return jsonb_build_object('ok', false, 'error', 'That time is outside the school day.'); end if;
  update public.ptm_events set slots = (select array_agg(distinct x order by x) from unnest(slots || t) x) where id = p_event;
  update public.ptm_classes set closed_slots = array_remove(closed_slots, t) where event_id = p_event;
  return jsonb_build_object('ok', true);
end; $$;

-- a child on its own again (own family number = student number)
create or replace function public.ptm_admin_split(p_class int, p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit('meetings') then raise exception 'not allowed'; end if;
  update public.ptm_students ps set family_no = s.student_no from public.students s
   where s.id = ps.student_id and ps.class_id = p_class and ps.student_id = p_student;
  return jsonb_build_object('ok', true);
end; $$;

-- the office cancels a booking (e.g. at a parent's request by phone)
create or replace function public.ptm_admin_cancel(p_class int, p_family int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit('meetings') then raise exception 'not allowed'; end if;
  delete from public.ptm_bookings where class_id = p_class and family_no = p_family;
  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.ptm_fill_class(int), public.ptm_teacher_view(), public.ptm_save_remark(int, uuid, text, text),
  public.ptm_parent_view(), public.ptm_admin_view(int), public.ptm_admin_set(int, uuid, boolean, uuid),
  public.ptm_admin_split(int, uuid), public.ptm_admin_cancel(int, int), public.ptm_admin_slot(int, text, boolean), public.ptm_admin_add_time(int, text), public.ptm_my_kinds(int), public.ptm_slot_end(int, time) from public;
grant execute on function public.ptm_fill_class(int), public.ptm_teacher_view(), public.ptm_save_remark(int, uuid, text, text),
  public.ptm_parent_view(), public.ptm_admin_view(int), public.ptm_admin_set(int, uuid, boolean, uuid),
  public.ptm_admin_split(int, uuid), public.ptm_admin_cancel(int, int), public.ptm_admin_slot(int, text, boolean), public.ptm_admin_add_time(int, text), public.ptm_my_kinds(int), public.ptm_slot_end(int, time) to authenticated;
-- Supabase grants anon execute on new functions by default: take it back
revoke execute on function public.ptm_fill_class(int), public.ptm_teacher_view(), public.ptm_save_remark(int, uuid, text, text),
  public.ptm_parent_view(), public.ptm_admin_view(int), public.ptm_admin_set(int, uuid, boolean, uuid),
  public.ptm_admin_split(int, uuid), public.ptm_admin_cancel(int, int), public.ptm_admin_slot(int, text, boolean), public.ptm_admin_add_time(int, text), public.ptm_my_kinds(int), public.ptm_slot_end(int, time) from anon;

-- ---------- 7. the first meeting: Wed 2026-11-18 (President 2026-11-02) ----------
-- 9:30 to 1:30 starts (12:30 added back 2026-11-03); booking open until the morning of the meeting.
-- Classes: Pre-K, KG, Grade 1 (the Grade 3 student is taught with Grade 1, so that link covers both).
do $$
declare ev int; c int; r record;
begin
  select id into ev from public.ptm_events where meet_date = '2026-11-18';
  if ev is null then
    insert into public.ptm_events (title, meet_date, slots, book_until)
    values ('Parent-Teacher Meeting', '2026-11-18',
            array['09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30']::time[],
            ('2026-11-18 09:00')::timestamp at time zone 'America/Los_Angeles')
    returning id into ev;
  end if;
  -- 2026-11-03: 12:30 offered again (the office can close it per class on Admin → Parent meetings)
  update public.ptm_events set slots = (select array_agg(distinct x order by x) from unnest(slots || '12:30'::time) x)
   where id = ev and not ('12:30'::time = any (slots));
  for r in select * from (values
      ('Pre-K',   array['Pre-K'],             1),
      ('KG',      array['KG'],                2),
      ('Grade 1', array['Grade 1','Grade 3'], 3)) v(name, grades, sort) loop
    select id into c from public.ptm_classes where event_id = ev and name = r.name;
    if c is null then
      insert into public.ptm_classes (event_id, name, grade_ids, sort)
      values (ev, r.name, (select array_agg(id order by level_order) from public.grades where name = any (r.grades)), r.sort)
      returning id into c;
      insert into public.ptm_links (class_id) values (c);
    end if;
    perform public.ptm_fill_class(c);
  end loop;
  -- short links /meet/prek, /meet/kg, /meet/grade1 (a slug belongs to one class at a time)
  update public.ptm_links l set slug = v.slug
    from public.ptm_classes c, (values ('Pre-K', 'prek'), ('KG', 'kg'), ('Grade 1', 'grade1')) v(name, slug)
   where c.id = l.class_id and c.event_id = ev and c.name = v.name and l.slug is null
     and not exists (select 1 from public.ptm_links x where x.slug = v.slug);
end $$;

-- check: the three links' classes and how many children / families each has
select c.name, l.slug, l.token, count(ps.*) as children, count(distinct ps.family_no) filter (where ps.invited) as families
  from public.ptm_classes c join public.ptm_links l on l.class_id = c.id
  left join public.ptm_students ps on ps.class_id = c.id
 group by c.name, l.slug, l.token, c.sort order by c.sort;
