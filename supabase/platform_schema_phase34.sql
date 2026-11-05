-- Phase 34 (2026-11-05, President): old announcements.
--
--   * Archiving an announcement (admin, or staff with edit on 'announcements') moves it to
--     "Old announcements" on the admin page and on the parent home, instead of hiding it
--     from parents. Both pages show the old ones collapsed, grouped by the month published.
--   * Parents see archived announcements for the academic year they were published in
--     (1 July – 30 June, Pacific). Nothing is deleted; admins and staff always see all.
--   * Parents are notified when an announcement is first published (insert, or draft ->
--     published). Archiving notifies nobody, and Restore (archived -> published) does not
--     notify again.
--   * announcements.archived_at records when it was archived (set and cleared by trigger).
--
-- Changes the ann_select RLS policy on public.announcements (parents may now read archived
-- rows of the current academic year). Safe to run more than once.

alter table public.announcements add column if not exists archived_at timestamptz;
update public.announcements set archived_at = now() where status = 'archived' and archived_at is null;

-- first day (1 July) of the academic year that contains d
create or replace function public.academic_year_start(d date)
returns date language sql immutable as $$
  select make_date(extract(year from d)::int - case when extract(month from d) < 7 then 1 else 0 end, 7, 1)
$$;

-- archived_at follows the status
create or replace function public.trg_announcement_archived_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'archived' then
    if tg_op = 'INSERT' or old.status is distinct from 'archived' or new.archived_at is null then
      new.archived_at := now();
    end if;
  else
    new.archived_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists announcement_archived_at on public.announcements;
create trigger announcement_archived_at before insert or update of status on public.announcements
  for each row execute function public.trg_announcement_archived_at();

-- BR-119, revised: notify only on first publication (not on Restore from archived)
create or replace function public.trg_announcement_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status = 'draft') then
    insert into public.notifications (recipient_id, title, message, priority, link_path)
    select distinct ps.parent_id,
      case when new.category = 'emergency' then 'EMERGENCY: ' || new.title else new.title end,
      left(new.content, 200),
      case when new.category = 'emergency' then 'action'
           when new.requires_ack then 'important' else 'info' end,
      '/parent'
    from public.parent_students ps
    join public.enrollments e on e.student_id = ps.student_id and e.status = 'active'
    where new.grade_id is null or e.grade_id = new.grade_id;
  end if;
  return new;
end; $$;

-- parents: published, plus archived ones published in the current academic year
drop policy if exists ann_select on public.announcements;
create policy ann_select on public.announcements for select using (
  public.is_admin()
  or (
    (status = 'published'
      or (status = 'archived'
          and (publish_date at time zone 'America/Los_Angeles')::date >= public.academic_year_start((now() at time zone 'America/Los_Angeles')::date)))
    and (grade_id is null or public.has_child_in_grade(grade_id))
  )
);

-- check
select status, count(*), min(publish_date)::date as first, max(publish_date)::date as last,
       public.academic_year_start((now() at time zone 'America/Los_Angeles')::date) as year_start
  from public.announcements group by status order by status;
