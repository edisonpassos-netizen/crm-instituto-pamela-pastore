-- Keep validated follow-ups available for an operator without claiming a message was sent.
-- Preserve delivery_unknown from the preceding migration: ambiguous provider outcomes
-- must remain representable and must never be treated as a normal retry or success.
alter table public.crm_automation_queue
  drop constraint if exists crm_automation_queue_status_check;

alter table public.crm_automation_queue
  add constraint crm_automation_queue_status_check
  check (status in ('pending','processing','retry','sent','completed','cancelled','dead_letter','delivery_unknown','awaiting_operator'));

comment on column public.crm_automation_queue.status is
  'Queue lifecycle; awaiting_operator means validated for manual contact, not sent; delivery_unknown means provider outcome is ambiguous and must be reconciled before any resend.';
