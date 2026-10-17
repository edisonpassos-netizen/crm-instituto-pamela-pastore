begin;

insert into public.crm_automation_queue
  (id, dedupe_key, event_type, source_type, source_id, channel, status, scheduled_at, payload)
values
  ('22222222-2222-4222-8222-222222222221', 'test-internal-claim-1', 'lead_follow_up_requested', 'task', 'task-internal', 'internal', 'pending', now() - interval '1 minute', '{}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'test-whatsapp-claim-1', 'follow_up', 'task', 'task-whatsapp', 'whatsapp', 'pending', now() - interval '1 minute', '{}'::jsonb),
  ('22222222-2222-4222-8222-222222222223', 'test-review-claim-1', 'service_completed', 'attendance', 'attendance-review', 'google_review', 'pending', now() - interval '1 minute', '{}'::jsonb);

create temporary table claimed_internal as
select id, channel from public.claim_due_internal_automation_jobs(10);

do $$
begin
  -- Other integration checks may leave valid internal jobs in this database.
  -- Require our fixture and validate every claimed channel, without assuming
  -- this test owns all queue rows.
  if (select count(*) from claimed_internal where id='22222222-2222-4222-8222-222222222221') <> 1 then
    raise exception 'internal claim must return the internal fixture';
  end if;
  if exists (select 1 from claimed_internal where channel <> 'internal') then
    raise exception 'internal claim returned an external channel';
  end if;
  if (select status from public.crm_automation_queue where id='22222222-2222-4222-8222-222222222222') is distinct from 'pending' then
    raise exception 'WhatsApp job was modified by internal claim';
  end if;
  if (select status from public.crm_automation_queue where id='22222222-2222-4222-8222-222222222223') is distinct from 'pending' then
    raise exception 'Google review job was modified by internal claim';
  end if;
  if has_function_privilege('anon', 'public.claim_due_internal_automation_jobs(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_due_internal_automation_jobs(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_due_internal_automation_jobs(integer)', 'EXECUTE') then
    raise exception 'internal claim must be restricted to the server role';
  end if;
end $$;

rollback;
