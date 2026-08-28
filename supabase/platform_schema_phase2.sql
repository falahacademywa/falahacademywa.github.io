-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 2 schema
-- Attendance (FR-003), Calendar (FR-009), Announcements (FR-010),
-- Notifications (FR-016). Run AFTER platform_schema.sql. Re-runnable.
-- ================================================================

-- ---------------- Attendance (source of truth: Google Sheets, BR-020) ----------------
-- Rows are written by the Apps Script sync (service role) and by admin edits.
create table if not exists public.attendance (
  id bigserial primary key,
  enrollment_id uuid not null references public.enrollments on delete cascade,
  date date not null,
  status text not null check (status in ('present','late','absent')),
  notes text,
  recorded_by text,                     -- teacher name/email from the sheet
  synced_at timestamptz not null default now(),
  unique (enrollment_id, date)
);

-- ---------------- Calendar (FR-009) ----------------
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_type text not null default 'event',   -- 'academic' | 'event' | 'holiday' | 'exam' | ...
  start_date date not null,
  end_date date,
  all_day boolean not null default true,
  start_time time,
  location text,
  description text,
  grade_id int references public.grades,      -- null = school-wide (BR-068)
  attachment_url text,
  rsvp_enabled boolean not null default false,
  created_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

create table if not exists public.event_rsvps (
  event_id uuid not null references public.calendar_events on delete cascade,
  parent_id uuid not null references public.profiles on delete cascade,
  response text not null check (response in ('yes','no')),
  attendees int not null default 1,
  primary key (event_id, parent_id)
);

-- ---------------- Announcements (FR-010) ----------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category text not null default 'general'
    check (category in ('general','reminder','academic','religious','emergency','event')),
  grade_id int references public.grades,      -- null = school-wide (BR-074)
  attachment_url text,
  is_pinned boolean not null default false,
  requires_ack boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  publish_date timestamptz,
  created_by uuid references public.profiles,
  created_at timestamptz not null default now()
);

create table if not exists public.announcement_acks (
  announcement_id uuid not null references public.announcements on delete cascade,
  parent_id uuid not null references public.profiles on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (announcement_id, parent_id)
);

-- ---------------- Notifications (FR-016) ----------------
create table if not exists public.notifications (
  id bigserial primary key,
  recipient_id uuid not null references public.profiles on delete cascade,
  title text not null,
  message text not null,
  priority text not null default 'info' check (priority in ('action','important','info')),
  link_path text,                             -- deep link inside the portal
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------- Helper: does this parent have a child in a grade? ----------------
create or replace function public.has_child_in_grade(gid int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.parent_students ps
    join public.enrollments e on e.student_id = ps.student_id and e.status = 'active'
    where ps.parent_id = auth.uid() and e.grade_id = gid
  )
$$;

-- ---------------- RLS ----------------
alter table public.attendance enable row level security;
alter table public.calendar_events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_acks enable row level security;
alter table public.notifications enable row level security;

drop policy if exists att_select on public.attendance;
create policy att_select on public.attendance for select using (
  public.is_admin()
  or exists (select 1 from public.enrollments e
             where e.id = enrollment_id and public.is_my_child(e.student_id))
);
drop policy if exists att_admin on public.attendance;
create policy att_admin on public.attendance for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists cal_select on public.calendar_events;
create policy cal_select on public.calendar_events for select using (
  public.is_admin() or grade_id is null or public.has_child_in_grade(grade_id)
);
drop policy if exists cal_admin on public.calendar_events;
create policy cal_admin on public.calendar_events for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists rsvp_own on public.event_rsvps;
create policy rsvp_own on public.event_rsvps for all
  using (parent_id = auth.uid() or public.is_admin())
  with check (parent_id = auth.uid() or public.is_admin());

drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select using (
  public.is_admin()
  or (status = 'published' and (grade_id is null or public.has_child_in_grade(grade_id)))
);
drop policy if exists ann_admin on public.announcements;
create policy ann_admin on public.announcements for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ack_own on public.announcement_acks;
create policy ack_own on public.announcement_acks for all
  using (parent_id = auth.uid() or public.is_admin())
  with check (parent_id = auth.uid() or public.is_admin());

drop policy if exists notif_own_select on public.notifications;
create policy notif_own_select on public.notifications for select
  using (recipient_id = auth.uid() or public.is_admin());
drop policy if exists notif_own_update on public.notifications;
create policy notif_own_update on public.notifications for update
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
drop policy if exists notif_admin on public.notifications;
create policy notif_admin on public.notifications for insert
  with check (public.is_admin());
