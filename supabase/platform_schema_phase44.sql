-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 44: Red Comet messages + test photos (President 2026-11-10)
--   1. redcomet_messages: the messages and comments from Red Comet (Buzz) teachers, one row per
--      message, kept for the school year (nothing is deleted automatically). Claude reads them in
--      Buzz with the President signed in and saves them here (service key, deduped by buzz_ref).
--      Workflow per message:
--        new → draft_requested (the President asks Claude for a reply, optional note)
--            → draft_ready (Claude wrote reply_draft) → approved (the President edited/approved it)
--            → replied (Claude posted it in Buzz, or the President marks it replied himself)
--        or no_reply (nothing to answer)
--      Our own replies are stored on the same row (reply_*), so a thread reads top to bottom.
--      Access: module 'redcomet' (view = read, edit = request/approve/mark).
--   2. work_uploads.kind: 'workbook' (default) or 'test' — teachers mark photos of a test or quiz
--      so Claude enters those answers exactly as the student marked them (blank stays blank).
-- Run in dev AND prod. Re-runnable.
-- ================================================================

create table if not exists public.redcomet_messages (
  id              bigserial primary key,
  buzz_ref        text unique,                          -- Buzz message / comment id (dedupe)
  student_id      uuid references public.students on delete set null,
  enrollment_id   uuid references public.enrollments on delete set null,
  subject         text not null default 'Other',        -- Language Arts | Math | Science | Other
  activity        text,                                 -- e.g. "11/01 - 11/07: Weekly Check-In", "Unit 3 Lesson 2"
  from_name       text,                                 -- the Red Comet teacher (or "Red Comet office")
  kind            text not null default 'message' check (kind in ('message', 'feedback', 'grade_comment', 'announcement')),
  title           text,
  body            text not null,
  sent_at         timestamptz not null,
  status          text not null default 'new' check (status in ('new', 'draft_requested', 'draft_ready', 'approved', 'replied', 'no_reply')),
  request_note    text,                                 -- the President's note for Claude ("say we'll redo page 12")
  reply_draft     text,
  reply_text      text,                                 -- what was finally posted
  approved_by     uuid references public.profiles on delete set null,
  approved_at     timestamptz,
  replied_at      timestamptz,
  replied_by      text,                                 -- 'Claude (in Buzz)' or the person who marked it
  school_year     text not null default '2026-2027',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists redcomet_messages_sent on public.redcomet_messages (sent_at desc);
create index if not exists redcomet_messages_status on public.redcomet_messages (status);
create index if not exists redcomet_messages_student on public.redcomet_messages (student_id);

alter table public.redcomet_messages enable row level security;
grant select, update on public.redcomet_messages to authenticated;
grant all on public.redcomet_messages to service_role;
grant usage, select on sequence public.redcomet_messages_id_seq to service_role;
drop policy if exists rcm_read on public.redcomet_messages;
create policy rcm_read on public.redcomet_messages for select to authenticated using (public.is_admin() or public.can_view('redcomet'));
drop policy if exists rcm_edit on public.redcomet_messages;
create policy rcm_edit on public.redcomet_messages for update to authenticated
  using (public.is_admin() or public.can_edit('redcomet')) with check (public.is_admin() or public.can_edit('redcomet'));
-- inserts and deletes: service role only (Claude's import)

create or replace function public.rcm_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_by := coalesce(auth.uid(), new.approved_by); new.approved_at := now();
  end if;
  if new.status = 'replied' and old.status is distinct from 'replied' then
    new.replied_at := coalesce(new.replied_at, now());
    new.reply_text := coalesce(new.reply_text, new.reply_draft);
  end if;
  return new;
end; $$;
drop trigger if exists rcm_touch on public.redcomet_messages;
create trigger rcm_touch before update on public.redcomet_messages for each row execute function public.rcm_touch();
drop trigger if exists redcomet_messages_audit_generic on public.redcomet_messages;
create trigger redcomet_messages_audit_generic after insert or update or delete on public.redcomet_messages
  for each row execute function public.row_audit_generic();

-- 2. test photos
alter table public.work_uploads add column if not exists kind text not null default 'workbook';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_uploads_kind_chk') then
    alter table public.work_uploads add constraint work_uploads_kind_chk check (kind in ('workbook', 'test', 'checkin'));
  end if;
end $$;
