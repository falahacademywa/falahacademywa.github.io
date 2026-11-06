-- Phase 38 (2026-11-05, security review): close internal helper functions to the public API.
-- Run in dev AND prod. Safe to run more than once.
--
-- Finding (verified in prod 2026-11-05): these SECURITY DEFINER helpers have no caller check and
-- were executable by `anon` and `authenticated` (Postgres grants EXECUTE to PUBLIC by default), so
-- anyone holding the publishable key (it is in every page of the website) could call them over
-- /rest/v1/rpc:
--   * email_now                 -> send any HTML e-mail from the school's Brevo account to anyone
--   * notify_admins             -> in-app notice + e-mail to every admin
--   * notify_parents_of_student -> fake school notices in a family's portal (then e-mailed)
--   * tr_notify                 -> fake teacher-request notices to anyone
--   * family_for_payer          -> confirms whether a named family is enrolled (child ids)
--   * expected_monthly          -> a family's monthly tuition total
--   * run_daily_notifications   -> run the e-mail dispatcher on demand
-- Every legitimate caller is another SECURITY DEFINER function or trigger (runs as the owner, so
-- it keeps working) or the GitHub Action with the service key (service_role keeps EXECUTE).
-- Checked: the portal and the website never call any of them directly.

do $$
declare f text; g text;
begin
  foreach f in array array[
    'public.email_now(text, text, text, text)',
    'public.notify_admins',
    'public.notify_parents_of_student',
    'public.tr_notify(uuid, text, text, text)',
    'public.family_for_payer',
    'public.expected_monthly',
    'public.run_daily_notifications'
  ] loop
    -- functions given without an argument list: apply to every overload of that name
    if position('(' in f) = 0 then
      for g in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = split_part(f, '.', 2) loop
        execute format('revoke execute on function %s from public, anon, authenticated', g);
        execute format('grant execute on function %s to service_role', g);
      end loop;
    else
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon_can,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can,
       has_function_privilege('service_role', p.oid, 'execute')  as service_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('email_now', 'notify_admins', 'notify_parents_of_student', 'tr_notify',
                     'family_for_payer', 'expected_monthly', 'run_daily_notifications')
 order by 1;
