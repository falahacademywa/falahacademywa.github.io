-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 47 (President 2026-11-22): tasks people can work in the portal
--
--   1. One number per task. A task gets its permanent number the moment it is created, in the
--      portal or in the office records, from one counter. No more temporary P-numbers, so a
--      notification link never points at a number that has since changed.
--   2. Editing. Admins edit everything; a staff login changes the status of (and closes) the
--      tasks it can see, and edits the ones it created itself. Edits made here are written into
--      the office records by the hourly sync (edit_pending) instead of being overwritten by it.
--   3. Comments and a change history on every task (task_notes). Never edited, never deleted.
--   4. Alerts without e-mail: a staff login creating, changing, closing, deleting or commenting
--      on a task alerts the full admins only (admin_only: not copied to other staff); an admin
--      changing or commenting on a staff member's task alerts that staff member.
--   5. Repeating tasks: daily (school days), weekly, monthly, yearly. The next one is created
--      when the current one is closed, so nothing piles up while one is still open.
--   Staff now also see the tasks they created for someone else.
-- $0: tables, functions and triggers in the existing project.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

-- ---------- 0. alerts that stay with the full admins ----------
alter table public.notifications add column if not exists admin_only boolean not null default false;

create or replace function public.trg_notification_fanout()
returns trigger language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if new.fanout_of is not null or new.admin_only then return new; end if;   -- a copy, or for the full admins only
  if not exists (select 1 from public.profiles where id = new.recipient_id and role = 'admin') then return new; end if;
  m := public.module_for_admin_link(new.link_path);
  if m is null then return new; end if;
  insert into public.notifications (recipient_id, title, message, priority, link_path, emailed, fanout_of)
  select sp.user_id, new.title, new.message, new.priority, new.link_path, true, new.id
    from public.staff_permissions sp
    join public.profiles p on p.id = sp.user_id and p.role = 'staff' and not coalesce(p.suspended, false)
   where sp.module = m
     and sp.user_id is distinct from auth.uid()                              -- not the person who caused it
     and not exists (select 1 from public.notifications x                    -- one copy per alert, even with several full admins
                      where x.recipient_id = sp.user_id and x.title = new.title and x.message = new.message
                        and x.link_path is not distinct from new.link_path
                        and x.created_at > now() - interval '2 minutes');
  return new;
end; $$;
revoke execute on function public.trg_notification_fanout() from public, anon, authenticated;

-- In-app alert (bell + phone, never e-mail) to every full admin except the person who caused it.
create or replace function public.alert_admins(p_title text, p_message text, p_link text,
                                               p_priority text default 'info', p_admin_only boolean default true)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, title, message, priority, link_path, emailed, admin_only)
  select p.id, left(p_title, 200), left(coalesce(nullif(p_message, ''), '—'), 500), p_priority, p_link, true, p_admin_only
    from public.profiles p
   where p.role = 'admin' and not coalesce(p.suspended, false) and p.id is distinct from auth.uid();
$$;
revoke execute on function public.alert_admins(text, text, text, text, boolean) from public, anon, authenticated;

-- Same, to one person (skipped when it is the person acting, or nobody).
create or replace function public.alert_user(p_user uuid, p_title text, p_message text, p_link text, p_priority text default 'info')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, title, message, priority, link_path, emailed)
  select p.id, left(p_title, 200), left(coalesce(nullif(p_message, ''), '—'), 500), p_priority, p_link, true
    from public.profiles p
   where p.id = p_user and p.id is distinct from auth.uid() and not coalesce(p.suspended, false);
$$;
revoke execute on function public.alert_user(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.my_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(full_name), '') from public.profiles where id = auth.uid()), 'The office')
$$;
revoke execute on function public.my_name() from public, anon;
grant execute on function public.my_name() to authenticated;

-- "today" for the school (Pacific), not the database server's UTC date
create or replace function public.school_today()
returns date language sql stable as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- ---------- 1. one number per task ----------
create sequence if not exists public.admin_tasks_no_seq;
do $$
declare m bigint; cur bigint; called boolean;
begin
  select coalesce(max(task_no), 0) into m from public.admin_tasks where code ~ '^[0-9]+$';
  select last_value, is_called into cur, called from public.admin_tasks_no_seq;
  if m >= 1 and (m > cur or not called) then perform setval('public.admin_tasks_no_seq', greatest(m, cur)); end if;
end $$;

-- internal: next free number, never at or below a number already on a task
create or replace function public.task_no_take()
returns int language plpgsql security definer set search_path = public as $$
declare n bigint; m bigint;
begin
  n := nextval('public.admin_tasks_no_seq');
  select coalesce(max(task_no), 0) into m from public.admin_tasks where code ~ '^[0-9]+$';
  if n <= m then
    n := m + 1;
    perform setval('public.admin_tasks_no_seq', n);
  end if;
  return n::int;
end; $$;
revoke execute on function public.task_no_take() from public, anon, authenticated;

-- the portal (anyone who may add tasks) and the office sync (service key) both draw from it
create or replace function public.next_task_no()
returns int language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit('tasks') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'tasks permission required';
  end if;
  return public.task_no_take();
end; $$;
revoke execute on function public.next_task_no() from public, anon;
grant execute on function public.next_task_no() to authenticated, service_role;

-- the office sync tells the counter the highest number in the records, so the two never collide
create or replace function public.task_no_floor(p_no int)
returns int language plpgsql security definer set search_path = public as $$
declare cur bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service key required'; end if;
  select last_value into cur from public.admin_tasks_no_seq;
  if p_no is not null and p_no > cur then perform setval('public.admin_tasks_no_seq', p_no); cur := p_no; end if;
  return cur::int;
end; $$;
revoke execute on function public.task_no_floor(int) from public, anon, authenticated;
grant execute on function public.task_no_floor(int) to service_role;

-- ---------- 2. columns ----------
alter table public.admin_tasks
  add column if not exists edit_pending boolean not null default false,   -- changed here, not yet written into the office records
  add column if not exists edited_at    timestamptz,
  add column if not exists edited_by    uuid references public.profiles on delete set null,
  add column if not exists repeat_every text,                             -- null | daily | weekly | monthly | yearly
  add column if not exists repeat_of    text;                             -- the occurrence this one followed
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_tasks_repeat_every_check') then
    alter table public.admin_tasks add constraint admin_tasks_repeat_every_check
      check (repeat_every is null or repeat_every in ('daily', 'weekly', 'monthly', 'yearly'));
  end if;
end $$;

-- staff: the tasks given to them AND the ones they created (phase 31: only the former)
drop policy if exists staff_admin_tasks_view on public.admin_tasks;
create policy staff_admin_tasks_view on public.admin_tasks for select
  using (public.can_view('tasks') and (assigned_user = auth.uid() or created_by = auth.uid()));
drop policy if exists staff_admin_tasks_insert on public.admin_tasks;
create policy staff_admin_tasks_insert on public.admin_tasks for insert
  with check (public.can_edit('tasks') and source in ('portal', 'recurring') and created_by = auth.uid());
drop policy if exists staff_admin_tasks_delete on public.admin_tasks;
create policy staff_admin_tasks_delete on public.admin_tasks for delete
  using (public.can_edit('tasks') and source in ('portal', 'recurring') and created_by = auth.uid());

-- ---------- 3. comments + change history ----------
create table if not exists public.task_notes (
  id          bigserial primary key,
  task_code   text not null,
  author_id   uuid references public.profiles on delete set null,
  author_name text not null default '',
  kind        text not null default 'comment' check (kind in ('comment', 'change')),
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists task_notes_task on public.task_notes (task_code, created_at);
alter table public.task_notes enable row level security;
grant select on public.task_notes to authenticated;
grant all on public.task_notes to service_role;
grant usage, select on sequence public.task_notes_id_seq to service_role;

-- read: whoever may see the task. No insert/update/delete policy: rows are written only by the
-- functions below, and nothing can change or remove them afterwards.
drop policy if exists task_notes_read on public.task_notes;
create policy task_notes_read on public.task_notes for select using (
  public.is_admin() or (public.can_view('tasks') and exists (
    select 1 from public.admin_tasks t
     where t.code = task_notes.task_code and (t.assigned_user = auth.uid() or t.created_by = auth.uid()))));

create or replace function public.task_note_add(p_code text, p_kind text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into public.task_notes (task_code, author_id, author_name, kind, body)
  values (p_code, auth.uid(), public.my_name(), p_kind, left(p_body, 4000));
$$;
revoke execute on function public.task_note_add(text, text, text) from public, anon, authenticated;

-- may the caller see this task? Always true or false: a task with no assignee and no creator
-- compares as "not yours", never as "unknown" (which an IF would let through).
create or replace function public.task_visible(t public.admin_tasks)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false)
      or (coalesce(public.can_view('tasks'), false)
          and (coalesce(t.assigned_user = auth.uid(), false) or coalesce(t.created_by = auth.uid(), false)))
$$;
revoke execute on function public.task_visible(public.admin_tasks) from public, anon, authenticated;

-- who hears about a change: a staff login acting -> the full admins only; an admin acting ->
-- the staff member the task belongs to (assignee, and its creator when that is someone else)
create or replace function public.task_alert(t public.admin_tasks, p_title text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare lnk text := '/admin/tasks?task=' || t.code;
begin
  if public.is_admin() then
    perform public.alert_user(t.assigned_user, p_title, p_message, lnk);
    if t.created_by is distinct from t.assigned_user
       and exists (select 1 from public.profiles where id = t.created_by and role = 'staff') then
      perform public.alert_user(t.created_by, p_title, p_message, lnk);
    end if;
  else
    perform public.alert_admins(p_title, p_message, lnk, 'info', true);
  end if;
end; $$;
revoke execute on function public.task_alert(public.admin_tasks, text, text) from public, anon, authenticated;

create or replace function public.task_snippet(p text)
returns text language sql immutable as $$ select left(regexp_replace(coalesce(p, ''), '\*\*|`', '', 'g'), 200) $$;

create or replace function public.task_comment(p_code text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.admin_tasks; b text := trim(coalesce(p_body, ''));
begin
  select * into t from public.admin_tasks where code = p_code;
  if not found or not coalesce(public.task_visible(t), false) then raise exception 'Task % not found', p_code; end if;
  if b = '' then raise exception 'Write the comment first'; end if;
  perform public.task_note_add(p_code, 'comment', b);
  perform public.task_alert(t, 'Comment on task ' || t.code || ' — ' || public.my_name(), left(b, 300));
end; $$;
revoke execute on function public.task_comment(text, text) from public, anon;
grant execute on function public.task_comment(text, text) to authenticated;

-- ---------- 4. editing ----------
-- p may carry: task, category, due_date (ISO date or null), status, assigned_to + assigned_user,
-- repeat_every (or null), notes. Only the keys present are changed.
create or replace function public.task_edit(p_code text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.admin_tasks; n public.admin_tasks;
  adm boolean := public.is_admin(); me uuid := auth.uid(); mine boolean;
  changes text[] := '{}'; v text; d date; closing boolean := false; reopening boolean := false;
begin
  if not coalesce(public.can_edit('tasks'), false) then raise exception 'You need edit rights on Tasks'; end if;
  select * into t from public.admin_tasks where code = p_code for update;
  if not found or not coalesce(public.task_visible(t), false) then raise exception 'Task % not found', p_code; end if;
  if t.source = 'teacher' then raise exception 'Teacher requests are managed on the Teacher requests page'; end if;
  if t.code ~ '^D' then    -- closed before phase 47, under the old D-numbering: the records keep it as it is
    raise exception 'This task was closed in the older records and cannot be changed here. Add a new task instead.';
  end if;
  mine := coalesce(adm, false) or coalesce(t.created_by = me, false);   -- may change more than the status
  n := t;

  if p ? 'status' then
    v := trim(coalesce(p->>'status', ''));
    if v not in ('Not started', 'In progress', 'Ready', 'Waiting', 'Parked', 'On hold', 'Done') then
      raise exception 'Unknown status "%"', v;
    end if;
    if v is distinct from t.status or (v = 'Done') is distinct from t.is_done then
      n.status := v;
      if v = 'Done' and not t.is_done then
        closing := true; n.is_done := true; n.done_on := public.school_today();
        changes := array_append(changes, 'Marked done');
      elsif v <> 'Done' and t.is_done then
        reopening := true; n.is_done := false; n.done_on := null;
        changes := array_append(changes, ('Reopened (' || v || ')'));
      else
        changes := array_append(changes, ('Status: ' || coalesce(nullif(t.status, ''), '—') || ' → ' || v));
      end if;
    end if;
  end if;

  if p ? 'due_date' then
    if not mine then raise exception 'Only the person who created this task, or an admin, can change its due date'; end if;
    d := nullif(trim(coalesce(p->>'due_date', '')), '')::date;
    if d is distinct from t.due_date then
      n.due_date := d; n.due_text := coalesce(d::text, '—');
      changes := array_append(changes, ('Due: ' || coalesce(to_char(t.due_date, 'Mon DD'), nullif(t.due_text, ''), '—') || ' → ' || coalesce(to_char(d, 'Mon DD'), 'no date')));
    end if;
  end if;

  if p ? 'task' then
    if not mine then raise exception 'Only the person who created this task, or an admin, can change its text'; end if;
    v := trim(regexp_replace(coalesce(p->>'task', ''), '\s+', ' ', 'g'));
    if v = '' then raise exception 'The task text cannot be empty'; end if;
    if v is distinct from t.task then n.task := v; changes := array_append(changes, 'Text edited'); end if;
  end if;

  if p ? 'category' then
    if not mine then raise exception 'Only the person who created this task, or an admin, can change its department'; end if;
    v := trim(coalesce(p->>'category', ''));
    if v <> '' and v is distinct from t.category then
      n.category := v; changes := array_append(changes, ('Department: ' || coalesce(nullif(t.category, ''), '—') || ' → ' || v));
    end if;
  end if;

  if p ? 'notes' then
    if not mine then raise exception 'Only the person who created this task, or an admin, can change its notes'; end if;
    v := nullif(trim(coalesce(p->>'notes', '')), '');
    if v is distinct from t.notes then n.notes := v; changes := array_append(changes, 'Notes edited'); end if;
  end if;

  if p ? 'assigned_to' then
    if not coalesce(adm, false) then raise exception 'Only an admin can give a task to someone else'; end if;
    v := trim(coalesce(p->>'assigned_to', ''));
    if v <> '' and (v is distinct from t.assigned_to
                    or nullif(p->>'assigned_user', '')::uuid is distinct from t.assigned_user) then
      n.assigned_to := v; n.assigned_user := nullif(p->>'assigned_user', '')::uuid;
      changes := array_append(changes, ('Assigned to ' || v));
    end if;
  end if;

  if p ? 'repeat_every' then
    if not mine then raise exception 'Only the person who created this task, or an admin, can change how it repeats'; end if;
    v := nullif(trim(coalesce(p->>'repeat_every', '')), '');
    if v is not null and v not in ('daily', 'weekly', 'monthly', 'yearly') then raise exception 'Unknown repeat "%"', v; end if;
    if v is not null and t.source = 'TODO.md' then
      raise exception 'A task from the office records cannot repeat; add a new repeating task instead';
    end if;
    if v is distinct from t.repeat_every then
      n.repeat_every := v;
      if t.source in ('portal', 'recurring') then n.source := case when v is null then 'portal' else 'recurring' end; end if;
      changes := array_append(changes, (case when v is null then 'Repeat stopped' else 'Repeats ' || v end));
    end if;
  end if;

  if array_length(changes, 1) is null then return; end if;    -- nothing actually changed

  update public.admin_tasks set
    status = n.status, is_done = n.is_done, done_on = n.done_on, due_date = n.due_date, due_text = n.due_text,
    task = n.task, category = n.category, notes = n.notes, assigned_to = n.assigned_to, assigned_user = n.assigned_user,
    repeat_every = n.repeat_every, source = n.source,
    edit_pending = (t.source = 'TODO.md') or t.edit_pending, edited_at = now(), edited_by = me, updated_at = now()
   where code = p_code;

  perform public.task_note_add(p_code, 'change', array_to_string(changes, ' · '));
  if array_length(changes, 1) = 1 and changes[1] like 'Assigned to %' and n.assigned_user is not null then
    return;      -- the assignment trigger already tells the new person
  end if;
  perform public.task_alert(n,
    'Task ' || t.code || case when closing then ' done' when reopening then ' reopened' else ' updated' end || ' — ' || public.my_name(),
    array_to_string(changes, ' · ') || ' — ' || public.task_snippet(n.task));
end; $$;
revoke execute on function public.task_edit(text, jsonb) from public, anon;
grant execute on function public.task_edit(text, jsonb) to authenticated;

-- ---------- 5. alerts for a staff login creating / deleting a task ----------
create or replace function public.trg_admin_tasks_staff_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.admin_tasks;
begin
  if auth.uid() is null or public.is_admin() then return null; end if;   -- the office sync, or an admin
  if tg_op = 'INSERT' then
    r := new;
    if r.repeat_of is not null then return null; end if;                -- the next occurrence of a repeating task
    perform public.alert_admins('New task ' || r.code || ' — ' || public.my_name(),
      public.task_snippet(r.task) || case when r.due_date is not null then ' — due ' || to_char(r.due_date, 'Mon DD') else '' end
        || case when coalesce(r.assigned_to, '') <> '' then ' — for ' || r.assigned_to else '' end
        || case when r.repeat_every is not null then ' — repeats ' || r.repeat_every else '' end,
      '/admin/tasks?task=' || r.code, 'info', true);
    perform public.task_note_add(r.code, 'change', 'Created');
  else
    r := old;
    perform public.alert_admins('Task ' || r.code || ' deleted — ' || public.my_name(), public.task_snippet(r.task),
      '/admin/tasks', 'important', true);
    perform public.task_note_add(r.code, 'change', 'Deleted: ' || public.task_snippet(r.task));
  end if;
  return null;
end; $$;
revoke execute on function public.trg_admin_tasks_staff_notify() from public, anon, authenticated;
drop trigger if exists admin_tasks_staff_notify on public.admin_tasks;
create trigger admin_tasks_staff_notify after insert or delete on public.admin_tasks
  for each row execute function public.trg_admin_tasks_staff_notify();

-- an admin creating a task in the portal: one "Created" line in its history
create or replace function public.trg_admin_tasks_created_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.is_admin() and new.source in ('portal', 'recurring') and new.repeat_of is null then
    perform public.task_note_add(new.code, 'change', 'Created');
  end if;
  return null;
end; $$;
revoke execute on function public.trg_admin_tasks_created_note() from public, anon, authenticated;
drop trigger if exists admin_tasks_created_note on public.admin_tasks;
create trigger admin_tasks_created_note after insert on public.admin_tasks
  for each row execute function public.trg_admin_tasks_created_note();

-- ---------- 6. repeating tasks ----------
-- is this a school day? Monday–Thursday and not inside a school-wide holiday on the calendar
create or replace function public.is_school_day(d date)
returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from d) between 1 and 4
     and not exists (select 1 from public.calendar_events c
                      where c.event_type = 'holiday' and c.grade_id is null
                        and d between c.start_date and coalesce(c.end_date, c.start_date))
$$;

-- the due date of the next occurrence: it follows the schedule (from the old due date), but is
-- never in the past, so a task closed late does not create one that is already overdue
create or replace function public.task_next_due(p_every text, p_due date)
returns date language plpgsql stable security definer set search_path = public as $$
declare today date := public.school_today(); base date := coalesce(p_due, public.school_today()); nxt date; i int := 0;
begin
  if p_every = 'daily' then
    nxt := greatest(base + 1, today);
    while not public.is_school_day(nxt) and i < 120 loop nxt := nxt + 1; i := i + 1; end loop;
    return nxt;
  end if;
  nxt := base;
  loop
    nxt := case p_every when 'weekly' then nxt + 7
                        when 'monthly' then (nxt + interval '1 month')::date
                        else (nxt + interval '1 year')::date end;
    i := i + 1;
    exit when nxt >= today or i > 600;
  end loop;
  return nxt;
end; $$;

create or replace function public.trg_admin_tasks_repeat()
returns trigger language plpgsql security definer set search_path = public as $$
declare no int; nd date;
begin
  if new.is_done and not old.is_done and new.repeat_every is not null
     and not exists (select 1 from public.admin_tasks x where x.repeat_of = new.code) then
    no := public.task_no_take();
    nd := public.task_next_due(new.repeat_every, old.due_date);
    insert into public.admin_tasks (code, task_no, is_done, category, task, assigned_to, assigned_user, due_text, due_date,
                                    status, done_on, source, notes, created_by, attachments, repeat_every, repeat_of)
    values (no::text, no, false, new.category, new.task, new.assigned_to, new.assigned_user, nd::text, nd,
            'Not started', null, 'recurring', new.notes, new.created_by, '[]'::jsonb, new.repeat_every, new.code);
    perform public.task_note_add(no::text, 'change', 'Created when task ' || new.code || ' was closed (repeats ' || new.repeat_every || ')');
  end if;
  return null;
end; $$;
revoke execute on function public.trg_admin_tasks_repeat() from public, anon, authenticated;
drop trigger if exists admin_tasks_repeat on public.admin_tasks;
create trigger admin_tasks_repeat after update of is_done on public.admin_tasks
  for each row execute function public.trg_admin_tasks_repeat();

-- check: 1 sequence, 5 columns, 1 table, 3 triggers
select 'counter at' as item, (select last_value::text from public.admin_tasks_no_seq) as value
union all select 'new admin_tasks columns', count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'admin_tasks'
             and column_name in ('edit_pending', 'edited_at', 'edited_by', 'repeat_every', 'repeat_of')
union all select 'task_notes table', count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'task_notes'
union all select 'task triggers', count(*)::text from pg_trigger
           where tgname in ('admin_tasks_staff_notify', 'admin_tasks_created_note', 'admin_tasks_repeat');
