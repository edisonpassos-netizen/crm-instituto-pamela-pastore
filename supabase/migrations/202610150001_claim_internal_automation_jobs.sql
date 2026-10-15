create or replace function public.claim_due_internal_automation_jobs(p_limit integer default 10)
returns setof public.crm_automation_queue
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with due as (
    select q.id
    from public.crm_automation_queue q
    where q.channel = 'internal'
      and (
        (q.status in ('pending', 'retry') and q.scheduled_at <= now())
        or (q.status = 'processing' and q.locked_at < now() - interval '10 minutes')
      )
    order by q.scheduled_at, q.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.crm_automation_queue q
  set status = 'processing',
      locked_at = now(),
      attempts = q.attempts + 1,
      updated_at = now()
  from due
  where q.id = due.id
  returning q.*;
$$;

revoke all on function public.claim_due_internal_automation_jobs(integer) from public;
revoke all on function public.claim_due_internal_automation_jobs(integer) from anon;
revoke all on function public.claim_due_internal_automation_jobs(integer) from authenticated;
grant execute on function public.claim_due_internal_automation_jobs(integer) to service_role;
