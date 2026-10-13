-- Keep validated follow-ups available for an operator without claiming a message was sent.
alter table public.crm_automation_queue
  drop constraint if exists crm_automation_queue_status_check;

alter table public.crm_automation_queue
  add constraint crm_automation_queue_status_check
  check (status in ('pending','processing','retry','sent','completed','cancelled','dead_letter','awaiting_operator'));

comment on column public.crm_automation_queue.status is
  'Queue lifecycle; awaiting_operator means validated for manual contact, not sent.';
