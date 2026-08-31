-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 9: parent feedback
-- Parents submit feedback from the portal; it lands in the admin
-- Feedback page and notifies admins (which the email dispatcher
-- forwards to the school inbox). Run in dev AND prod. Re-runnable.
-- ================================================================

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles on delete cascade,
  category text not null default 'general'
    check (category in ('general','attendance','fees','class','portal','other')),
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists fb_parent_insert on public.feedback;
create policy fb_parent_insert on public.feedback for insert
  with check (parent_id = auth.uid());

drop policy if exists fb_parent_select on public.feedback;
create policy fb_parent_select on public.feedback for select
  using (parent_id = auth.uid() or public.is_admin());

drop policy if exists fb_admin on public.feedback;
create policy fb_admin on public.feedback for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists fb_admin_del on public.feedback;
create policy fb_admin_del on public.feedback for delete
  using (public.is_admin());

-- Notify every admin on new feedback (the daily email dispatcher then
-- forwards it to the school inbox, since admin profiles carry that email).
create or replace function public.trg_feedback_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare pname text;
begin
  select full_name into pname from public.profiles where id = new.parent_id;
  insert into public.notifications (recipient_id, title, message, priority, link_path)
  select p.id, 'Parent feedback (' || new.category || ')',
    coalesce(pname, 'A parent') || ': ' || left(new.message, 200),
    'important', '/admin/feedback'
  from public.profiles p where p.role = 'admin';
  return new;
end; $$;
drop trigger if exists feedback_notify on public.feedback;
create trigger feedback_notify after insert on public.feedback
  for each row execute function public.trg_feedback_notify();
