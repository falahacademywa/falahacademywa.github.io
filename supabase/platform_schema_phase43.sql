-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 43: delete announcements and social posts (President 2026-11-10)
--   1. announcement_delete(id): the President, an admin, or staff with Announcements: edit.
--      Removes the announcement, its acknowledgements, the bell notifications it created and
--      any unposted Facebook/Instagram draft made from it. E-mails already sent cannot be recalled.
--      The audit log keeps a copy of what was deleted.
--   2. social_can_delete(id): the President, an admin, or staff with Social posts: edit.
--      The social-post Edge Function (delete_post) removes a posted item from the Facebook page
--      and then from the queue; Instagram does not allow apps to delete posts, so those are
--      deleted in the Instagram app (the portal says so).
-- Run in dev AND prod. Re-runnable.
-- ================================================================

create or replace function public.announcement_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; n_notif int := 0; n_draft int := 0; n_posted int := 0;
begin
  if not (public.is_admin() or public.can_edit('announcements')) then raise exception 'announcements edit permission required'; end if;
  select * into a from public.announcements where id = p_id;
  if a is null then raise exception 'announcement not found'; end if;
  if a.publish_date is not null then
    delete from public.notifications n
     using public.profiles pr
     where pr.id = n.recipient_id and pr.role = 'parent'
       and n.link_path = '/parent'
       and n.title in (a.title, 'EMERGENCY: ' || a.title)
       and n.created_at between a.publish_date - interval '1 hour' and a.publish_date + interval '1 hour';
    get diagnostics n_notif = row_count;
  end if;
  if to_regclass('public.social_posts') is not null then
    delete from public.social_posts where source = 'announcement' and source_ref = p_id::text and status not in ('posting', 'posted');
    get diagnostics n_draft = row_count;
    select count(*) into n_posted from public.social_posts where source = 'announcement' and source_ref = p_id::text and status = 'posted';
  end if;
  delete from public.announcements where id = p_id;     -- acknowledgements go with it (on delete cascade)
  return jsonb_build_object('notifications', n_notif, 'social_drafts', n_draft, 'social_posted', n_posted);
end; $$;
revoke execute on function public.announcement_delete(uuid) from public, anon;
grant execute on function public.announcement_delete(uuid) to authenticated;

create or replace function public.social_can_delete(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select (public.is_admin() or public.can_edit('social')) and exists (select 1 from public.social_posts where id = p_id)
$$;
revoke execute on function public.social_can_delete(bigint) from public, anon;
grant execute on function public.social_can_delete(bigint) to authenticated;
