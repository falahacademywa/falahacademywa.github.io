-- ================================================================
-- FALAH ACADEMY PLATFORM — Phase 13: audit trail for payment corrections
-- Admin -> Fees gained Edit and Delete on recorded payments (2026-09-13).
-- Admins already have update/delete rights via the pay_admin policy; this
-- trigger records every change in audit_log. security definer is required
-- because audit_log has no client insert policy. The parent "payment
-- received" notification (payment_notify) stays insert-only.
-- Run in dev AND prod. Re-runnable.
-- ================================================================

create or replace function public.payments_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.audit_log (actor, action, entity, entity_id, old_value, new_value)
    values (auth.uid(), 'update_payment', 'payment', old.id::text, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor, action, entity, entity_id, old_value)
    values (auth.uid(), 'delete_payment', 'payment', old.id::text, to_jsonb(old));
    return old;
  end if;
  return null;
end; $$;

drop trigger if exists payments_audit on public.payments;
create trigger payments_audit after update or delete on public.payments
  for each row execute function public.payments_audit();
