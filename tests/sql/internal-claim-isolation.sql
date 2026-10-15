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
  if (select count(*) from claimed_internal) <> 1 then
    raise exception 'internal claim must return exactly one internal job';
  end if;
  if exists (select 1 from claimed_internal where channel <> 'internal') then
    raise exception 'internal claim returned an external channel';
  end if;
  if (select status from public.crm_automation_queue where id='22222222-2222-4222-8222-222222222222') <> 'pending' then
    raise exception 'WhatsApp job was modified by internal claim';
  end if;
  if (select status from public.crm_automation_queue where id='22222222-2222-4222-8222-222222222223') <> 'pending' then
    raise exception 'Google review job was modified by internal claim';
  end if;
end $$;

rollback;
