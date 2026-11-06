-- Phase 36 (2026-11-05, President): Facebook + Instagram post queue (TODO #110).
--
--   * Admin -> Social posts (staff permission module 'social'): add, edit, approve, post,
--     skip, delete and archive posts for the Facebook page and the Instagram account.
--   * Approved templates (marketing/social-media/post-templates.md) are seeded below and stay
--     editable in the portal; the 40-item Faith & reflection bank too.
--   * "Manual" means the President or an admin clicks Post. Only the fixed school-calendar
--     posts (T1, T2, T3, T5 that are not moon-related) may be scheduled; the poster sends them
--     when due. Staff with edit on 'social' may post only the unplanned-closure posts (T6).
--   * STRICT (President 2026-11-05): never any photo of a child. Images are designed text cards
--     drawn in the browser, or an uploaded image that must carry the "no children in this image"
--     confirmation (enforced below). Never tuition, fees or scholarships; no names.
--   * Archive: posted and skipped posts, grouped Academic year -> Month -> Category in the
--     portal, kept 2 years (social_purge_old()).
--   * Posting runs in the Edge Function `social-post` with the page key in the Function secrets
--     FB_PAGE_TOKEN, FB_PAGE_ID, IG_USER_ID (never in files). In the DEV project the function
--     makes unpublished test posts only.
--
-- New tables, functions, policies and a public bucket for the cards. Safe to run more than once.

create table if not exists public.social_templates (
  key           text primary key,
  category      text not null,
  name          text not null,
  body          text not null,
  card_headline text not null default '',
  card_sub      text not null default '',
  card_style    text not null default 'navy' check (card_style in ('navy', 'gold', 'amber', 'calm')),
  manual        boolean not null default true,
  active        boolean not null default true,
  sort          int not null default 100,
  updated_by    uuid references public.profiles on delete set null,
  updated_at    timestamptz not null default now()
);

create table if not exists public.social_posts (
  id              bigserial primary key,
  category        text not null,
  template_key    text references public.social_templates on delete set null,
  title           text not null default '',          -- internal label in the queue
  body            text not null default '',          -- the post text (Facebook and Instagram caption)
  card_headline   text not null default '',
  card_sub        text not null default '',
  card_style      text not null default 'navy' check (card_style in ('navy', 'gold', 'amber', 'calm')),
  card_url        text,                              -- public URL of the rendered card (PNG)
  image_url       text,                              -- uploaded image instead of the card (public URL)
  image_no_children boolean not null default false,  -- STRICT rule: required for an uploaded image
  platforms       text[] not null default '{facebook,instagram}',
  status          text not null default 'draft'
                  check (status in ('draft', 'needs_date', 'scheduled', 'posting', 'posted', 'failed', 'skipped')),
  manual          boolean not null default true,
  scheduled_at    timestamptz,
  source          text not null default 'manual' check (source in ('manual', 'template', 'calendar', 'announcement', 'faith')),
  source_ref      text,                              -- calendar event id + template, announcement id, faith item n
  fb_post_id      text,
  ig_media_id     text,
  ig_permalink    text,
  error           text,
  test_run        boolean not null default false,    -- dev: unpublished test post only
  posted_at       timestamptz,
  posted_by       uuid references public.profiles on delete set null,
  created_by      uuid references public.profiles on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint social_posts_photo_rule check (image_url is null or image_no_children),
  constraint social_posts_schedule_rule check (status <> 'scheduled' or (scheduled_at is not null and not manual))
);
create index if not exists social_posts_status on public.social_posts (status, scheduled_at);
create unique index if not exists social_posts_source_ref on public.social_posts (source, source_ref) where source_ref is not null;

create table if not exists public.social_faith_bank (
  n          int primary key,
  kind       text not null,
  meaning    text not null,
  reference  text not null,
  tip        text not null,
  used_post  bigint references public.social_posts on delete set null,
  used_at    timestamptz
);

alter table public.social_templates enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_faith_bank enable row level security;

do $$
declare t text;
begin
  foreach t in array array['social_templates', 'social_posts', 'social_faith_bank'] loop
    execute format('drop policy if exists %1$s_view on public.%1$s', t);
    execute format('create policy %1$s_view on public.%1$s for select using (public.can_view(''social''))', t);
    execute format('drop policy if exists %1$s_edit on public.%1$s', t);
    execute format('create policy %1$s_edit on public.%1$s for all using (public.can_edit(''social'')) with check (public.can_edit(''social''))', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
    execute format('grant all on public.%1$s to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.social_posts_id_seq to authenticated, service_role;

-- posting status and the posted ids are written only by the Edge Function (service role)
create or replace function public.trg_social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then new.updated_at := now(); return new; end if;
  if tg_op = 'UPDATE' and old.status in ('posting', 'posted') then
    raise exception 'this post has already been sent; it can no longer be changed';
  end if;
  if new.status in ('posting', 'posted') then raise exception 'only the poster can mark a post as sent'; end if;
  if new.status = 'scheduled' and not public.is_admin() then raise exception 'only the President or an admin can schedule a post'; end if;
  new.fb_post_id := case when tg_op = 'UPDATE' then old.fb_post_id end;
  new.ig_media_id := case when tg_op = 'UPDATE' then old.ig_media_id end;
  new.ig_permalink := case when tg_op = 'UPDATE' then old.ig_permalink end;
  new.posted_at := case when tg_op = 'UPDATE' then old.posted_at end;
  new.posted_by := case when tg_op = 'UPDATE' then old.posted_by end;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists social_posts_guard on public.social_posts;
create trigger social_posts_guard before insert or update on public.social_posts
  for each row execute function public.trg_social_posts_guard();

-- a posted post cannot be deleted from the portal (it stays in the archive for 2 years)
drop policy if exists social_posts_edit on public.social_posts;
create policy social_posts_edit on public.social_posts for update using (public.can_edit('social')) with check (public.can_edit('social'));
drop policy if exists social_posts_insert on public.social_posts;
create policy social_posts_insert on public.social_posts for insert with check (public.can_edit('social'));
drop policy if exists social_posts_delete on public.social_posts;
create policy social_posts_delete on public.social_posts for delete using (public.can_edit('social') and status not in ('posting', 'posted'));

-- may the caller press Post on this post? President/admins: yes. Staff with edit on 'social':
-- only the unplanned-closure posts (T6a/b/c). Called by the Edge Function with the caller's key.
create or replace function public.social_can_post(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.can_edit('social') and exists (select 1 from public.social_posts p where p.id = p_id and p.template_key like 'T6%'))
$$;
grant execute on function public.social_can_post(bigint) to authenticated;

-- the poster claims a post (status -> posting) so two clicks cannot post twice
create or replace function public.social_claim(p_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.social_posts set status = 'posting', error = null where id = p_id and status not in ('posting', 'posted');
  return found;
end; $$;
revoke all on function public.social_claim(bigint) from public, anon, authenticated;
grant execute on function public.social_claim(bigint) to service_role;

-- archive retention: posted/skipped posts older than 2 years are removed
create or replace function public.social_purge_old()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_edit('social') and auth.role() <> 'service_role' then return 0; end if;
  delete from public.social_posts where status in ('posted', 'skipped')
     and coalesce(posted_at, updated_at) < now() - interval '2 years';
  get diagnostics n = row_count;
  return n;
end; $$;
grant execute on function public.social_purge_old() to authenticated, service_role;

-- cards and uploaded images: public bucket (Instagram must be able to fetch them)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social', 'social', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png'];
drop policy if exists social_media_insert on storage.objects;
create policy social_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'social' and public.can_edit('social'));
drop policy if exists social_media_update on storage.objects;
create policy social_media_update on storage.objects for update to authenticated
  using (bucket_id = 'social' and public.can_edit('social'));
drop policy if exists social_media_read on storage.objects;
create policy social_media_read on storage.objects for select using (bucket_id = 'social');
drop policy if exists social_media_delete on storage.objects;
create policy social_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'social' and public.can_edit('social'));

-- seed: approved templates (marketing/social-media/post-templates.md, 2026-11-05); existing rows are left as edited
insert into public.social_templates (key, category, name, body, card_headline, card_sub, card_style, manual, sort) values
  ($t$T1$t$, $t$School calendar$t$, $t$Single-day closure$t$, $t$Assalamu Alaikum, dear families! 📅

Falah Academy will be closed on {day}, {date} for {event}. Classes resume {resume_day}, {resume_date} at 9:00 AM.

Enjoy the day with your family! JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org/calendar.html

#FalahAcademy$t$, $t$No School$t$, $t${day}, {date} · {event}$t$, 'navy', false, 1),
  ($t$T2$t$, $t$School calendar$t$, $t$Break begins$t$, $t$Assalamu Alaikum, dear families! 🗓️

{break} begins {start_day}, {start_date}. Falah Academy will be closed from {start_date} to {end_date}, and classes resume {resume_day}, {resume_date} at 9:00 AM.

{wish}

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org/calendar.html

#FalahAcademy$t$, $t${break}$t$, $t${start_date} – {end_date} · Classes resume {resume_day}, {resume_date}$t$, 'navy', false, 2),
  ($t$T3$t$, $t$School calendar$t$, $t$School resumes$t$, $t$Assalamu Alaikum, dear families! 🎒

Welcome back! School resumes {when}. Please have your children at school by 8:50 AM.

We look forward to seeing everyone, Insha'Allah!

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org/calendar.html

#FalahAcademy$t$, $t$Welcome Back!$t$, $t$School resumes {resume_day}, {resume_date} · 8:50 AM$t$, 'gold', false, 3),
  ($t$T5$t$, $t$School calendar$t$, $t$Last day of school$t$, $t$Assalamu Alaikum, dear families! 🎓

Thursday, June 24 is the last day of the {school_year} school year at Falah Academy. Classes end at 2:00 PM as usual.

Alhamdulillah for a wonderful year of learning, Qur'an and growth. Thank you to our families, teachers, volunteers and the Al Huda Islamic Center community for your trust and support.

We wish everyone a safe and blessed summer!

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy$t$, $t$Last Day of School$t$, $t$Thursday, June 24, 2027 · Thank you for a wonderful year!$t$, 'gold', false, 4),
  ($t$T6a$t$, $t$School calendar$t$, $t$Unplanned closure$t$, $t$Assalamu Alaikum, dear families! ⚠️

Due to {reason}, Falah Academy will be CLOSED {when}.

Please stay safe. We will share any further update here and on WhatsApp.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy$t$, $t$School Closed$t$, $t${when} · {reason}$t$, 'amber', true, 5),
  ($t$T6b$t$, $t$School calendar$t$, $t$Late start$t$, $t$Assalamu Alaikum, dear families! ⏰

Due to {reason}, Falah Academy will open LATE {when}. Please bring your children by {arrival_time}; classes begin at {start_time}.

Please travel safely. We will share any further update here and on WhatsApp.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy$t$, $t$Late Start$t$, $t${when} · Arrive by {arrival_time}$t$, 'amber', true, 6),
  ($t$T6c$t$, $t$School calendar$t$, $t$Early dismissal$t$, $t$Assalamu Alaikum, dear families! ⚠️

Due to {reason}, Falah Academy will dismiss EARLY {when} at {dismiss_time}. Please pick up your children by {dismiss_time}.

Please stay safe. We will share any further update here and on WhatsApp.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy$t$, $t$Early Dismissal$t$, $t${when} · Pick up by {dismiss_time}$t$, 'amber', true, 7),
  ($t$I-1$t$, $t$Islamic calendar$t$, $t$15 Sha'ban$t$, $t$Assalamu Alaikum, dear families! 🌙

We are now in the middle of Sha'ban, and Ramadan is only about a month away, Insha'Allah.

This is a beautiful time to prepare our hearts and our homes: a little more Qur'an each day, voluntary fasts if you are able, and talking with our children about the blessings of the coming month.

May Allah allow us all to reach Ramadan. Ameen.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy$t$, $t$Mid-Sha'ban$t$, $t$Ramadan is about a month away$t$, 'navy', true, 8),
  ($t$I-2a$t$, $t$Islamic calendar$t$, $t$Ramadan hours notice$t$, $t$Assalamu Alaikum, dear families! 🌙

Ramadan is expected to begin around {expected_date}, Insha'Allah. During Ramadan, Falah Academy will follow Ramadan hours:

🕘 9:30 AM – 2:00 PM, Monday to Thursday

Please plan drop-off for 9:20 AM from the first day of Ramadan. We will confirm the start date once the moon is sighted.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org/calendar.html

#FalahAcademy #Ramadan$t$, $t$Ramadan Hours$t$, $t$9:30 AM – 2:00 PM · Drop-off 9:20 AM$t$, 'navy', true, 9),
  ($t$I-2b$t$, $t$Islamic calendar$t$, $t$Ramadan Mubarak$t$, $t$Ramadan Mubarak! 🌙✨

Assalamu Alaikum, dear families. Alhamdulillah, Ramadan begins {start_day}, {start_date}. May Allah accept our fasts, our prayers and our good deeds, and fill our homes with peace and barakah this month.

A reminder: Ramadan school hours are 9:30 AM – 2:00 PM, with drop-off at 9:20 AM.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #Ramadan$t$, $t$Ramadan Mubarak$t$, $t$Ramadan begins {start_day}, {start_date}$t$, 'gold', true, 10),
  ($t$I-3$t$, $t$Islamic calendar$t$, $t$Last ten nights$t$, $t$Assalamu Alaikum, dear families! 🌙✨

The last ten nights of Ramadan begin {start_day}, Insha'Allah, the most blessed nights of the year. Among them is Laylat al-Qadr, "better than a thousand months" (Qur'an 97:3).

Let's make the most of these nights with our families: extra prayer, Qur'an, du'a and charity. Even a little, done with sincerity, is precious. Involve the children with a short du'a or a few verses together each night.

May Allah grant us all Laylat al-Qadr and accept from us. Ameen.

If you would like to include Falah Academy in your Ramadan giving: falahacademywa.org/donate.html

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #Ramadan$t$, $t$The Last Ten Nights$t$, $t$Better than a thousand months · Qur'an 97:3$t$, 'navy', true, 11),
  ($t$I-4$t$, $t$Islamic calendar$t$, $t$Eid al-Fitr$t$, $t$Eid Mubarak! 🌙✨

Assalamu Alaikum, dear families. On behalf of everyone at Falah Academy, we wish you and your loved ones a joyful and blessed Eid al-Fitr.

Taqabbal Allahu minna wa minkum: may Allah accept from us and from you our fasts, prayers and good deeds of Ramadan.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #EidMubarak$t$, $t$Eid Mubarak$t$, $t$Eid al-Fitr {year}$t$, 'gold', true, 12),
  ($t$I-5$t$, $t$Islamic calendar$t$, $t$First ten days of Dhul Hijjah$t$, $t$Assalamu Alaikum, dear families! 🕋

The first ten days of Dhul Hijjah begin {start_day}, Insha'Allah, the best days of the year. The Prophet ﷺ said there are no days in which good deeds are more beloved to Allah than these ten days (Sahih al-Bukhari).

Let's fill these days with dhikr (SubhanAllah, Alhamdulillah, La ilaha illallah, Allahu Akbar), Qur'an, charity and voluntary fasting, especially on the Day of Arafah. Teaching the children the takbeer together is a lovely family activity.

May Allah accept from all of us. Ameen.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #DhulHijjah$t$, $t$The Best Ten Days$t$, $t$Dhul Hijjah {year}$t$, 'navy', true, 13),
  ($t$I-6$t$, $t$Islamic calendar$t$, $t$Day of Arafah$t$, $t$Assalamu Alaikum, dear families! 🤲

Tomorrow, {day}, {date}, is the Day of Arafah, Insha'Allah, the greatest day of the year for du'a. The Prophet ﷺ said that fasting this day expiates the sins of the previous year and the coming year (Sahih Muslim).

If you are able, join in the fast, and make plenty of du'a for yourselves, your families, our community and the whole Ummah. Please remember Falah Academy in your du'as too.

May Allah accept from all of us. Ameen.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #DayOfArafah$t$, $t$Day of Arafah$t$, $t$The best day for du'a$t$, 'navy', true, 14),
  ($t$I-7$t$, $t$Islamic calendar$t$, $t$Eid al-Adha$t$, $t$Eid Mubarak! 🌙✨

Assalamu Alaikum, dear families. On behalf of everyone at Falah Academy, we wish you and your loved ones a joyful and blessed Eid al-Adha.

May Allah accept the Hajj of the pilgrims, accept our sacrifices and good deeds, and fill our homes with peace and barakah.

Taqabbal Allahu minna wa minkum.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #EidMubarak$t$, $t$Eid Mubarak$t$, $t$Eid al-Adha {year}$t$, 'gold', true, 15),
  ($t$I-8$t$, $t$Islamic calendar$t$, $t$Hijri New Year$t$, $t$Assalamu Alaikum, dear families! 🌙

As the new Islamic year {hijri_year} AH begins, Insha'Allah, we thank Allah for the blessings of the past year and ask Him to make the coming year one of faith, learning and goodness for our families and our community.

May Allah bless us all in the year ahead. Ameen.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #IslamicNewYear$t$, $t$Hijri New Year$t$, $t${hijri_year} AH$t$, 'navy', true, 16),
  ($t$A-1$t$, $t$Announcements$t$, $t$Announcement$t$, $t$Assalamu Alaikum, dear families! 📢

{title}

{content}

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy$t$, $t${title}$t$, $t${date}$t$, 'navy', true, 17),
  ($t$AD-1$t$, $t$Admissions$t$, $t$Now enrolling$t$, $t$Assalamu Alaikum! 🏫

Falah Academy, Kent's first full-time Islamic school, is now enrolling for the {school_year} school year: Pre-K (age 4), Kindergarten (age 5) and Grade 1 (age 6).

Every day your child grows in four programs:
📖 Qur'an reading
🕌 Islamic studies (MESBA curriculum)
✏️ Washington-accredited academics (Red Comet)
💻 STEM with iCode

🕘 Monday to Thursday, 9:00 AM – 2:00 PM, at Al Huda Islamic Center, Kent.

Apply online in minutes: falahacademywa.org/admissions.html#enroll
📞 (301) 919-0106

— Falah Academy

#FalahAcademy #KentWA #IslamicSchool$t$, $t$Now Enrolling {school_year}$t$, $t$Pre-K · KG · Grade 1$t$, 'gold', true, 18),
  ($t$AD-3$t$, $t$Admissions$t$, $t$Open house$t$, $t$Assalamu Alaikum! 🏫

You're invited to the Falah Academy Open House!

📅 {day}, {date}
🕘 {start_time} – {end_time}
📍 Al Huda Islamic Center, 25650 101st Ave SE, Kent

Meet our teachers, see our classrooms and learn about our Qur'an, Islamic studies, academics and STEM programs. Children are welcome!

Questions: 📞 (301) 919-0106

— Falah Academy

#FalahAcademy #KentWA #IslamicSchool$t$, $t$Open House$t$, $t${day}, {date} · {start_time} – {end_time}$t$, 'gold', true, 19),
  ($t$FR-1$t$, $t$Faith & reflection$t$, $t$Verse or hadith of the week$t$, $t$Assalamu Alaikum, dear families! 🌿

"{meaning}"
({reference})

{family_tip}

Jumu'ah Mubarak!

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #JumuahMubarak$t$, $t${meaning}$t$, $t${reference}$t$, 'calm', true, 20),
  ($t$CV-1$t$, $t$Community & volunteers$t$, $t$Volunteer call$t$, $t$Assalamu Alaikum! 🤝

Would you like to help Kent's first full-time Islamic school grow? Falah Academy is looking for volunteers!

✏️ In the classroom: support small groups in reading, math, Qur'an and more, always under a teacher's supervision.
🎓 Gain experience: students and graduates in education, Islamic studies or childcare can build classroom hours and a reference.
🏫 Behind the scenes: help with events, fundraising, the library or the office.

School days are Monday to Thursday, 9:00 AM – 2:00 PM. Even a few hours a week makes a difference.

Apply online: falahacademywa.org/volunteer.html

— Falah Academy

#FalahAcademy #Volunteer #KentWA$t$, $t$Volunteer With Us$t$, $t$falahacademywa.org/volunteer.html$t$, 'navy', true, 21),
  ($t$CV-2$t$, $t$Community & volunteers$t$, $t$Thank you to volunteers$t$, $t$Assalamu Alaikum! 💚

A heartfelt thank you to our wonderful volunteers and to the Al Huda Islamic Center community. {occasion_line}

Your time, effort and du'as help our children grow in faith and learning every day. May Allah reward you abundantly. Ameen.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #Volunteer #KentWA$t$, $t$Thank You!$t$, $t$JazakumAllahu khairan$t$, 'gold', true, 22),
  ($t$EV-1$t$, $t$Events$t$, $t$Graduation Day$t$, $t$Assalamu Alaikum, dear families! 🎓

The Falah Academy Graduation Ceremony will be held on the last day of school, {day}, {date}, Insha'Allah.

🕘 {time}
📍 {venue}

Students and their families are warmly invited to celebrate a year of learning, Qur'an and growth together.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #Graduation$t$, $t$Graduation {year}$t$, $t${day}, {date}$t$, 'gold', true, 23),
  ($t$EV-1b$t$, $t$Events$t$, $t$Congratulations, graduates$t$, $t$Congratulations to our graduates! 🎓✨

Alhamdulillah, Falah Academy celebrated its {school_year} graduation today. We are so proud of every one of our students for a year of hard work, Qur'an and growth.

Thank you to our families, teachers, volunteers and the Al Huda Islamic Center community for making it possible. May Allah bless our graduates in every step ahead. Ameen.

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy #Graduation$t$, $t$Congratulations, Graduates!$t$, $t${school_year}$t$, 'gold', true, 24),
  ($t$EV-2$t$, $t$Events$t$, $t$General event$t$, $t$Assalamu Alaikum! 📣

{event_name}

📅 {day}, {date}
🕘 {start_time} – {end_time}
📍 {venue}

{description}

{rsvp_line}

JazakumAllahu khairan.

— Falah Academy
🌐 falahacademywa.org

#FalahAcademy$t$, $t${event_name}$t$, $t${day}, {date} · {start_time}$t$, 'navy', true, 25)
on conflict (key) do nothing;

-- seed: faith & reflection bank (faith-reflection-bank.md, 40 items)
insert into public.social_faith_bank (n, kind, meaning, reference, tip) values
  (1, $t$Qur'an$t$, $t$Indeed, with hardship comes ease.$t$, $t$Qur'an 94:6$t$, $t$When your child finds something hard this week, a new surah or a tricky math problem, remind them of this verse and keep going together.$t$),
  (2, $t$Hadith$t$, $t$Actions are judged by their intentions.$t$, $t$Sahih al-Bukhari 1; Sahih Muslim 1907$t$, $t$Before school or homework, help your child say what they are doing it for: "to learn and to please Allah."$t$),
  (3, $t$Qur'an$t$, $t$My Lord, increase me in knowledge.$t$, $t$Qur'an 20:114$t$, $t$Teach your child this short du'a ("Rabbi zidni 'ilma") to say before studying.$t$),
  (4, $t$Hadith$t$, $t$The best of you are those who learn the Qur'an and teach it.$t$, $t$Sahih al-Bukhari 5027$t$, $t$Ask your child to teach you one ayah they learned this week.$t$),
  (5, $t$Qur'an$t$, $t$Remember Me, and I will remember you.$t$, $t$Qur'an 2:152$t$, $t$Pick one dhikr for the car ride to school and say it together each morning.$t$),
  (6, $t$Hadith$t$, $t$None of you truly believes until he loves for his brother what he loves for himself.$t$, $t$Sahih al-Bukhari 13; Sahih Muslim 45$t$, $t$Ask at dinner: "What good thing did you wish for a friend today?"$t$),
  (7, $t$Qur'an$t$, $t$Surely, in the remembrance of Allah do hearts find rest.$t$, $t$Qur'an 13:28$t$, $t$When your child is upset or worried, sit with them and say "SubhanAllah" slowly together.$t$),
  (8, $t$Hadith$t$, $t$Smiling at your brother is charity.$t$, $t$Jami' at-Tirmidhi 1956$t$, $t$Make it a family challenge: everyone gives three sincere smiles a day.$t$),
  (9, $t$Qur'an$t$, $t$Allah does not burden any soul beyond what it can bear.$t$, $t$Qur'an 2:286$t$, $t$Remind your child that Allah knows they can do it, and so do you.$t$),
  (10, $t$Hadith$t$, $t$Whoever believes in Allah and the Last Day should say something good or stay silent.$t$, $t$Sahih al-Bukhari 6018; Sahih Muslim 47$t$, $t$Practise "good words only" for one day as a family.$t$),
  (11, $t$Qur'an$t$, $t$Be kind to your parents; do not even say "uff" to them.$t$, $t$Qur'an 17:23$t$, $t$Talk with your child about polite ways to answer when they are asked to do something.$t$),
  (12, $t$Hadith$t$, $t$The strong person is not the one who wins a fight, but the one who controls himself when angry.$t$, $t$Sahih al-Bukhari 6114; Sahih Muslim 2609$t$, $t$Agree on a family "calm down" step: stop, say "A'udhu billah", take a breath.$t$),
  (13, $t$Qur'an$t$, $t$Read in the name of your Lord who created.$t$, $t$Qur'an 96:1$t$, $t$Read a short story together this week and start with "Bismillah".$t$),
  (14, $t$Hadith$t$, $t$Whoever follows a path seeking knowledge, Allah makes easy for him a path to Paradise.$t$, $t$Sahih Muslim 2699$t$, $t$Tell your child that every school day is a step on that path.$t$),
  (15, $t$Qur'an$t$, $t$If you are grateful, I will surely give you more.$t$, $t$Qur'an 14:7$t$, $t$At bedtime, ask everyone to name one thing they are thankful to Allah for.$t$),
  (16, $t$Hadith$t$, $t$Allah is gentle and loves gentleness in all things.$t$, $t$Sahih al-Bukhari 6927; Sahih Muslim 2593$t$, $t$Notice and praise one gentle thing your child does this week.$t$),
  (17, $t$Qur'an$t$, $t$Whoever puts their trust in Allah, He is enough for them.$t$, $t$Qur'an 65:3$t$, $t$Before a test or a new challenge, say "Tawakkaltu 'ala Allah" together.$t$),
  (18, $t$Hadith$t$, $t$Purity is half of faith.$t$, $t$Sahih Muslim 223$t$, $t$Make tidying up and washing for salah part of the family routine, and explain why.$t$),
  (19, $t$Qur'an$t$, $t$Seek help through patience and prayer; Allah is with those who are patient.$t$, $t$Qur'an 2:153$t$, $t$Praise your child when they wait patiently for their turn.$t$),
  (20, $t$Hadith$t$, $t$The deeds most beloved to Allah are the most consistent, even if small.$t$, $t$Sahih al-Bukhari 6464; Sahih Muslim 783$t$, $t$Choose one small daily habit, like one ayah a day, and keep it all week.$t$),
  (21, $t$Qur'an$t$, $t$The most honoured of you in the sight of Allah is the most righteous.$t$, $t$Qur'an 49:13$t$, $t$Talk with your child about how good character matters more than looks or things.$t$),
  (22, $t$Hadith$t$, $t$Whoever does not thank people has not thanked Allah.$t$, $t$Sunan Abi Dawud 4811; Jami' at-Tirmidhi 1954$t$, $t$Help your child write or say a thank-you to a teacher this week.$t$),
  (23, $t$Qur'an$t$, $t$When you are greeted, return the greeting with one better, or at least the same.$t$, $t$Qur'an 4:86$t$, $t$Practise the full salam at home: "Wa alaikum assalam wa rahmatullahi wa barakatuh."$t$),
  (24, $t$Hadith$t$, $t$Spread the greeting of salam among yourselves.$t$, $t$Sahih Muslim 54$t$, $t$Encourage your child to greet their classmates with salam each morning.$t$),
  (25, $t$Qur'an$t$, $t$Do not lose hope in the mercy of Allah.$t$, $t$Qur'an 39:53$t$, $t$When your child makes a mistake, remind them that Allah loves those who say sorry and try again.$t$),
  (26, $t$Hadith$t$, $t$Make things easy and do not make them hard; give good news and do not push people away.$t$, $t$Sahih al-Bukhari 69$t$, $t$Look for one way to make someone's day easier, as a family.$t$),
  (27, $t$Qur'an$t$, $t$The servants of the Most Merciful walk on the earth humbly, and answer harsh words with peace.$t$, $t$Qur'an 25:63$t$, $t$Role-play with your child how to answer calmly when someone is unkind.$t$),
  (28, $t$Hadith$t$, $t$Every good deed is charity.$t$, $t$Sahih al-Bukhari 6021; Sahih Muslim 1005$t$, $t$Count the small good deeds your child does in a day; each one is a sadaqah.$t$),
  (29, $t$Qur'an$t$, $t$Do good; Allah loves those who do good.$t$, $t$Qur'an 2:195$t$, $t$Ask your child to plan one surprise good deed for a family member.$t$),
  (30, $t$Hadith$t$, $t$The best of you are those with the best character.$t$, $t$Sahih al-Bukhari 6035$t$, $t$Pick one manner to practise this week: saying please, thank you, or sorry.$t$),
  (31, $t$Qur'an$t$, $t$In the Messenger of Allah you have an excellent example.$t$, $t$Qur'an 33:21$t$, $t$Share one short story from the Prophet's ﷺ life at dinner.$t$),
  (32, $t$Hadith$t$, $t$He is not one of us who does not show mercy to our young and respect our elders.$t$, $t$Jami' at-Tirmidhi 1919$t$, $t$Encourage older siblings to help the younger ones, and everyone to greet grandparents first.$t$),
  (33, $t$Qur'an$t$, $t$Repel evil with what is better.$t$, $t$Qur'an 41:34$t$, $t$When there is a quarrel between siblings, help them answer with a kind word.$t$),
  (34, $t$Hadith$t$, $t$A good word is charity.$t$, $t$Sahih al-Bukhari 2989; Sahih Muslim 1009$t$, $t$Ask your child to say one kind word to someone at school each day.$t$),
  (35, $t$Qur'an$t$, $t$My Lord, have mercy on my parents as they raised me when I was small.$t$, $t$Qur'an 17:24$t$, $t$Teach your child this du'a for their parents ("Rabbir hamhuma kama rabbayani saghira").$t$),
  (36, $t$Hadith$t$, $t$The upper hand (the one that gives) is better than the lower hand (the one that takes).$t$, $t$Sahih al-Bukhari 1429$t$, $t$Let your child put the coins in the masjid box or choose a toy to give away.$t$),
  (37, $t$Qur'an$t$, $t$Our Lord, make our families and children a comfort to our eyes.$t$, $t$Qur'an 25:74$t$, $t$Make this du'a together as a family after salah this week.$t$),
  (38, $t$Hadith$t$, $t$Asked who most deserves good company, the Prophet ﷺ said: your mother, then your mother, then your mother, then your father.$t$, $t$Sahih al-Bukhari 5971; Sahih Muslim 2548$t$, $t$Help your child plan a small surprise to thank their mother.$t$),
  (39, $t$Qur'an$t$, $t$Do not walk on the earth arrogantly, and do not turn your face away from people in pride.$t$, $t$Qur'an 31:18$t$, $t$Talk about being humble when we win and kind when others lose.$t$),
  (40, $t$Hadith$t$, $t$Do not get angry.$t$, $t$Sahih al-Bukhari 6116$t$, $t$Remind each other gently with a family signal when tempers rise.$t$)
on conflict (n) do nothing;

-- check
select (select count(*) from public.social_templates) as templates,
       (select count(*) from public.social_faith_bank) as faith_items,
       (select count(*) from public.social_posts) as posts,
       exists (select 1 from storage.buckets where id = 'social') as bucket;
