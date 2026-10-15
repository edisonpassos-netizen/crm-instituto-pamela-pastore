-- Provider delivery receipts from WhatsApp Business Platform webhooks.
-- Proposed only; do not run on production without explicit approval.
alter table public.crm_automation_attempts
  add column if not exists provider_status text
    check (provider_status is null or provider_status in ('sent','delivered','read','failed')),
  add column if not exists provider_status_at timestamptz,
  add column if not exists provider_error_code text,
  add column if not exists provider_error_title text;

create index if not exists crm_automation_attempts_provider_message_idx
  on public.crm_automation_attempts (provider_message_id)
  where provider_message_id is not null;

revoke all on table public.crm_automation_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.crm_automation_attempts to service_role;
