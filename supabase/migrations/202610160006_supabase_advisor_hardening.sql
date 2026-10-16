-- Address current Supabase security/performance advisor findings without
-- changing application behavior or exposing client access.

-- RLS already defaults to deny when no policy matches. These explicit deny
-- policies make that intent auditable and keep anon/authenticated closed even
-- if table grants change accidentally in the future.
drop policy if exists "deny client access to crm app state" on public.crm_app_state;
create policy "deny client access to crm app state"
on public.crm_app_state
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "deny client access to crm automation queue" on public.crm_automation_queue;
create policy "deny client access to crm automation queue"
on public.crm_automation_queue
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "deny client access to crm automation attempts" on public.crm_automation_attempts;
create policy "deny client access to crm automation attempts"
on public.crm_automation_attempts
for all
to anon, authenticated
using (false)
with check (false);

-- Cover all foreign keys from customer experience to the automation queue.
-- Tables are currently small, so ordinary CREATE INDEX is appropriate and
-- safe inside the migration transaction.
create index if not exists crm_customer_experience_request_queue_id_idx
  on public.crm_customer_experience(request_queue_id);

create index if not exists crm_customer_experience_recovery_queue_id_idx
  on public.crm_customer_experience(recovery_queue_id);

create index if not exists crm_customer_experience_review_queue_id_idx
  on public.crm_customer_experience(review_queue_id);
