-- Phase 35 (2026-11-05, President): teacher requests & tracking (TODO #163).
--
--   * Teachers add requests from the teacher app (title, details, type, urgency, optional
--     student, optional photo). Every teacher sees every request of the current academic
--     year. A teacher may edit or delete their own request until it is approved or declined.
--   * The President and admins (role admin) move a request to "Under discussion", approve it
--     or decline it (reason shown to teachers). Approving creates a task in Admin -> Tasks
--     (code T<request no>, source 'teacher'); the request stays the source of truth and the
--     task row follows it (status, due date) by trigger.
--   * Full history: every status change and every note is a row in teacher_request_notes.
--     Notes are visible to teachers unless the admin marks them internal.
--   * Resolved (done) and declined requests are archived (archived_at). Nothing is deleted:
--     teachers see the current academic year only, admins see every year.
--   * In-app notifications only: new request -> admins; decision, status change or
--     teacher-visible note -> the teacher who asked.
--   * Staff permission module 'teacher_requests' (view = read, edit = notes and progress).
--
-- New tables, functions, policies and a private bucket. Safe to run more than once.

create table if not exists public.teacher_requests (
  id            bigserial primary key,
  created_by    uuid not null references public.profiles on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  details       text,
  type          text not null default 'Other'
                check (type in ('Supplies','Classroom/facility','Curriculum','Student matter','IT/portal','Schedule/leave','Other')),
  urgency       text not null default 'normal' check (urgency in ('normal','urgent')),
  student_id    uuid references public.students on delete set null,
  photo_path    text,
  status        text not null default 'submitted'
                check (status in ('submitted','discussing','approved','in_progress','done','declined')),
  decline_reason text,
  due_date      date,
  task_code     text,
  decided_by    uuid references public.profiles on delete set null,
  decided_at    timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists teacher_requests_created on public.teacher_requests (created_at desc);

create table if not exists public.teacher_request_notes (
  id          bigserial primary key,
  request_id  bigint not null references public.teacher_requests on delete cascade,
  author_id   uuid references public.profiles on delete set null,
  kind        text not null default 'note' check (kind in ('note','status')),
  internal    boolean not null default false,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists teacher_request_notes_req on public.teacher_request_notes (request_id, created_at);

alter table public.teacher_requests enable row level security;
alter table public.teacher_request_notes enable row level security;

-- reads go through teacher_requests_feed(); direct reads only for admins / staff with the module
drop policy if exists tr_select on public.teacher_requests;
create policy tr_select on public.teacher_requests for select using (public.can_view('teacher_requests'));
drop policy if exists trn_select on public.teacher_request_notes;
create policy trn_select on public.teacher_request_notes for select using (public.can_view('teacher_requests'));
-- every write goes through the functions below (security definer)
grant select on public.teacher_requests, public.teacher_request_notes to authenticated;
grant all on public.teacher_requests, public.teacher_request_notes to service_role;
grant usage, select on sequence public.teacher_requests_id_seq, public.teacher_request_notes_id_seq to service_role;

-- ---------- helpers ----------
create or replace function public.tr_label(s text)
returns text language sql immutable as $$
  select case s when 'submitted' then 'Submitted' when 'discussing' then 'Under discussion'
    when 'approved' then 'Approved' when 'in_progress' then 'In progress' when 'done' then 'Resolved'
    when 'declined' then 'Declined' else s end $$;

create or replace function public.tr_category(t text)
returns text language sql immutable as $$
  select case t when 'Curriculum' then 'Academics' when 'Student matter' then 'Students & Families'
    when 'IT/portal' then 'IT' when 'Schedule/leave' then 'HR' else 'Operations' end $$;

-- current academic year (1 July, Pacific) — academic_year_start() comes from phase 34
create or replace function public.tr_year_start()
returns date language sql stable as $$
  select public.academic_year_start((now() at time zone 'America/Los_Angeles')::date) $$;

-- can the caller see this request? admins/module: all; teachers: current academic year
create or replace function public.tr_visible(r public.teacher_requests)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view('teacher_requests')
      or (public.is_teacher() and (r.created_at at time zone 'America/Los_Angeles')::date >= public.tr_year_start())
$$;

create or replace function public.tr_notify(rcpt uuid, ttl text, msg text, lnk text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (recipient_id, title, message, priority, link_path)
  select rcpt, ttl, left(msg, 240), 'info', lnk where rcpt is not null and rcpt is distinct from auth.uid()
$$;

-- ---------- feed: requests + history in one call ----------
create or replace function public.teacher_requests_feed()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare admin boolean := public.can_view('teacher_requests');
begin
  if not admin and not public.is_teacher() then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
        'id', r.id, 'title', r.title, 'details', r.details, 'type', r.type, 'urgency', r.urgency,
        'status', r.status, 'decline_reason', r.decline_reason, 'due_date', r.due_date,
        'task_code', r.task_code, 'photo_path', r.photo_path,
        'created_at', r.created_at, 'updated_at', r.updated_at, 'archived_at', r.archived_at,
        'decided_at', r.decided_at,
        'mine', r.created_by = auth.uid(),
        'requester', coalesce(nullif(trim(t.first_name || ' ' || t.last_name), ''), p.full_name),
        'student_id', r.student_id,
        'student', case when s.id is null then null else s.first_name || ' ' || s.last_name || ' (' || s.student_no || ')' end,
        'notes', coalesce((
          select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'internal', n.internal, 'body', n.body,
                   'created_at', n.created_at, 'author', coalesce(a.full_name, 'Office'), 'mine', n.author_id = auth.uid())
                 order by n.created_at)
            from public.teacher_request_notes n left join public.profiles a on a.id = n.author_id
           where n.request_id = r.id and (admin or not n.internal)), '[]'::jsonb)
      ) as x
      from public.teacher_requests r
      join public.profiles p on p.id = r.created_by
      left join public.teachers t on t.user_id = r.created_by
      left join public.students s on s.id = r.student_id
      where public.tr_visible(r)
    ) q), '[]'::jsonb);
end; $$;
grant execute on function public.teacher_requests_feed() to authenticated;

-- ---------- teacher: create / edit / delete ----------
create or replace function public.teacher_request_save(
  p_id bigint, p_title text, p_details text, p_type text, p_urgency text, p_student uuid, p_photo text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r public.teacher_requests; new_id bigint; nm text;
begin
  if not public.is_teacher() and not public.is_admin() then raise exception 'teachers only'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  if p_id is null then
    insert into public.teacher_requests (created_by, title, details, type, urgency, student_id, photo_path)
    values (auth.uid(), trim(p_title), nullif(trim(p_details), ''), coalesce(p_type, 'Other'),
            coalesce(p_urgency, 'normal'), p_student, p_photo)
    returning id into new_id;
    select full_name into nm from public.profiles where id = auth.uid();
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    select a.id, case when p_urgency = 'urgent' then 'URGENT teacher request R' else 'New teacher request R' end || new_id,
           coalesce(nm, 'A teacher') || ': ' || left(trim(p_title), 180),
           case when p_urgency = 'urgent' then 'important' else 'info' end, '/admin/teacher-requests?r=' || new_id
      from public.profiles a where a.role = 'admin' and a.id <> auth.uid();
    return new_id;
  end if;
  select * into r from public.teacher_requests where id = p_id;
  if not found then raise exception 'request not found'; end if;
  if r.created_by <> auth.uid() then raise exception 'only the teacher who asked can edit it'; end if;
  if r.status not in ('submitted', 'discussing') then raise exception 'this request has been decided and can no longer be edited'; end if;
  update public.teacher_requests set title = trim(p_title), details = nullif(trim(p_details), ''), type = coalesce(p_type, type),
         urgency = coalesce(p_urgency, urgency), student_id = p_student, photo_path = p_photo, updated_at = now()
   where id = p_id;
  return p_id;
end; $$;
grant execute on function public.teacher_request_save(bigint, text, text, text, text, uuid, text) to authenticated;

create or replace function public.teacher_request_delete(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare r public.teacher_requests;
begin
  select * into r from public.teacher_requests where id = p_id;
  if not found then raise exception 'request not found'; end if;
  if not public.is_admin() and (r.created_by <> auth.uid() or r.status not in ('submitted', 'discussing')) then
    raise exception 'only the teacher who asked can delete it, and only before it is decided';
  end if;
  delete from public.admin_tasks where code = r.task_code and source = 'teacher';
  delete from public.teacher_requests where id = p_id;
  return r.photo_path;   -- the app removes the photo from storage
end; $$;
grant execute on function public.teacher_request_delete(bigint) to authenticated;

-- ---------- notes (teachers: visible notes on any request they can see; admins: optional internal) ----------
create or replace function public.teacher_request_add_note(p_id bigint, p_body text, p_internal boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r public.teacher_requests; admin boolean := public.can_edit('teacher_requests');
begin
  select * into r from public.teacher_requests where id = p_id;
  if not found or not public.tr_visible(r) then raise exception 'request not found'; end if;
  if not admin and not public.is_teacher() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'empty note'; end if;
  insert into public.teacher_request_notes (request_id, author_id, kind, internal, body)
  values (p_id, auth.uid(), 'note', admin and coalesce(p_internal, false), trim(p_body));
  update public.teacher_requests set updated_at = now() where id = p_id;
  if admin and not coalesce(p_internal, false) then
    perform public.tr_notify(r.created_by, 'Note on your request R' || p_id, trim(p_body), '/teacher/requests?r=' || p_id);
  elsif not admin then
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    select a.id, 'Teacher note on R' || p_id, left(trim(p_body), 240), 'info', '/admin/teacher-requests?r=' || p_id
      from public.profiles a where a.role = 'admin' and a.id <> auth.uid();
  end if;
end; $$;
grant execute on function public.teacher_request_add_note(bigint, text, boolean) to authenticated;

-- ---------- admin: decide and track ----------
-- p_status: 'discussing' | 'approved' | 'declined' | 'in_progress' | 'done' | 'submitted' (reopen)
-- approve/decline: President and admins only; progress (in_progress/done, due date): also staff with edit on the module
create or replace function public.teacher_request_set_status(p_id bigint, p_status text, p_reason text default null, p_due date default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.teacher_requests; msg text;
begin
  select * into r from public.teacher_requests where id = p_id;
  if not found then raise exception 'request not found'; end if;
  if p_status in ('approved', 'declined', 'discussing', 'submitted') and not public.is_admin() then
    raise exception 'only the President or an admin can approve or decline';
  end if;
  if not public.can_edit('teacher_requests') then raise exception 'not allowed'; end if;
  if p_status = 'declined' and coalesce(trim(p_reason), '') = '' then raise exception 'give a short reason for declining'; end if;
  if p_status in ('in_progress', 'done') and r.status not in ('approved', 'in_progress', 'done') then
    raise exception 'approve the request first';
  end if;
  update public.teacher_requests set
    status = p_status,
    decline_reason = case when p_status = 'declined' then trim(p_reason) else null end,
    due_date = coalesce(p_due, due_date),
    decided_by = case when p_status in ('approved', 'declined') then auth.uid() else decided_by end,
    decided_at = case when p_status in ('approved', 'declined') then now() else decided_at end,
    archived_at = case when p_status in ('done', 'declined') then coalesce(archived_at, now()) else null end,
    task_code = case when p_status in ('approved', 'in_progress', 'done') then 'T' || p_id else task_code end,
    updated_at = now()
  where id = p_id;
  if p_status is distinct from r.status then
    msg := 'Status: ' || public.tr_label(p_status)
        || case when p_status = 'declined' then ' — ' || trim(p_reason) else '' end
        || case when p_due is not null then ' (due ' || to_char(p_due, 'Mon DD') || ')' else '' end;
    insert into public.teacher_request_notes (request_id, author_id, kind, body) values (p_id, auth.uid(), 'status', msg);
    perform public.tr_notify(r.created_by, 'Your request R' || p_id || ': ' || public.tr_label(p_status),
                             r.title || case when p_status = 'declined' then ' — ' || trim(p_reason) else '' end,
                             '/teacher/requests?r=' || p_id);
  elsif p_due is not null and p_due is distinct from r.due_date then
    insert into public.teacher_request_notes (request_id, author_id, kind, body)
    values (p_id, auth.uid(), 'status', 'Due date set to ' || to_char(p_due, 'Mon DD, YYYY'));
  end if;
end; $$;
grant execute on function public.teacher_request_set_status(bigint, text, text, date) to authenticated;

-- ---------- the task in Admin -> Tasks follows the request ----------
create or replace function public.trg_teacher_request_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text; nm text;
begin
  if new.status in ('approved', 'in_progress', 'done') then
    st := case new.status when 'approved' then 'Not started' when 'in_progress' then 'In progress' else 'Done' end;
    select coalesce(nullif(trim(t.first_name || ' ' || t.last_name), ''), p.full_name) into nm
      from public.profiles p left join public.teachers t on t.user_id = p.id where p.id = new.created_by;
    insert into public.admin_tasks (code, task_no, is_done, category, task, assigned_to, due_text, due_date, status, done_on,
                                    source, created_by, created_at, notes, updated_at)
    values ('T' || new.id, new.id, new.status = 'done', public.tr_category(new.type),
            '**Teacher request R' || new.id || ' (' || new.type || '):** ' || new.title,
            'Muneeb (Principal)', coalesce(new.due_date::text, '—'), new.due_date, st,
            case when new.status = 'done' then (now() at time zone 'America/Los_Angeles')::date end,
            'teacher', new.created_by, new.created_at,
            'From ' || coalesce(nm, 'a teacher') || ' in the teacher app. Track and update it in Admin → Teacher requests.'
              || case when new.details is not null then E'\n\n' || new.details else '' end,
            now())
    on conflict (code) do update set is_done = excluded.is_done, category = excluded.category, task = excluded.task,
      due_text = excluded.due_text, due_date = excluded.due_date, status = excluded.status, done_on = excluded.done_on,
      notes = excluded.notes, updated_at = now();
  elsif tg_op = 'UPDATE' and old.task_code is not null then
    delete from public.admin_tasks where code = old.task_code and source = 'teacher';
  end if;
  return new;
end; $$;
drop trigger if exists teacher_request_task on public.teacher_requests;
create trigger teacher_request_task after insert or update on public.teacher_requests
  for each row execute function public.trg_teacher_request_task();

-- ---------- photos: private bucket, path <uid>/<file> ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-requests', 'teacher-requests', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists teacher_requests_photo_insert on storage.objects;
create policy teacher_requests_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'teacher-requests' and (public.is_teacher() or public.is_admin())
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists teacher_requests_photo_read on storage.objects;
create policy teacher_requests_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'teacher-requests' and (public.is_teacher() or public.can_view('teacher_requests')));
drop policy if exists teacher_requests_photo_delete on storage.objects;
create policy teacher_requests_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'teacher-requests' and (public.is_admin() or owner = auth.uid()));

-- check
select (select count(*) from public.teacher_requests) as requests,
       (select count(*) from public.teacher_request_notes) as notes,
       public.tr_year_start() as year_start,
       exists (select 1 from storage.buckets where id = 'teacher-requests') as bucket;
