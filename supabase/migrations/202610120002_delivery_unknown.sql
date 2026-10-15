-- Add an explicit hold state for WhatsApp calls with an ambiguous outcome.
-- This is a proposed migration only; do not apply to production without approval.
alter table public.crm_automation_queue
  drop constraint if exists crm_automation_queue_status_check;

alter table public.crm_automation_queue
  add constraint crm_automation_queue_status_check
  check (status in ('pending','processing','retry','sent','completed','cancelled','dead_letter','delivery_unknown'));

-- Ambiguous sends require operator reconciliation; never include them in automatic claims.
comment on column public.crm_automation_queue.status is
  'delivery_unknown means the provider call outcome is ambiguous and must be reconciled before any resend.';
