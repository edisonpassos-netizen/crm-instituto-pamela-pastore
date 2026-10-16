\set ON_ERROR_STOP on

begin;

select public.register_customer_experience_request(
  'attendance','attendance-experience-fixture-1','lead-fixture-1',
  '5515999999999','Maria','Pilates experimental',
  '{"consent_at":"2026-10-16T12:00:00Z"}'::jsonb
);

select public.enqueue_crm_automation(
  'crm:satisfaction_request:experience:' || (
    select id::text from public.crm_customer_experience
    where source_type='attendance' and source_id='attendance-experience-fixture-1'
  ),
  'satisfaction_request','customer_experience',
  (select id::text from public.crm_customer_experience where source_type='attendance' and source_id='attendance-experience-fixture-1'),
  '5515999999999',
  jsonb_build_object(
    'experience_id',(select id::text from public.crm_customer_experience where source_type='attendance' and source_id='attendance-experience-fixture-1'),
    'customer_opt_in',true
  ),
  'whatsapp',now(),3
);

update public.crm_automation_queue
set status='processing', attempts=1, locked_at=now()
where event_type='satisfaction_request'
  and source_id=(select id::text from public.crm_customer_experience where source_id='attendance-experience-fixture-1');

select public.complete_customer_experience_send(
  (select id from public.crm_automation_queue where event_type='satisfaction_request' and source_id=(select id::text from public.crm_customer_experience where source_id='attendance-experience-fixture-1')),
  'wamid.REQUEST_FIXTURE_1','satisfaction_request'
);

do $$
declare v_exp public.crm_customer_experience%rowtype;
declare v_job public.crm_automation_queue%rowtype;
begin
  select * into v_exp from public.crm_customer_experience where source_id='attendance-experience-fixture-1';
  if v_exp.status <> 'awaiting_response' or v_exp.request_provider_message_id <> 'wamid.REQUEST_FIXTURE_1' then
    raise exception 'satisfaction request was not finalized atomically';
  end if;
  select * into v_job from public.crm_automation_queue where event_type='satisfaction_request' and source_id=v_exp.id::text;
  if v_job.status <> 'sent' or v_job.provider_message_id <> 'wamid.REQUEST_FIXTURE_1' then
    raise exception 'queue send state was not finalized atomically';
  end if;
end $$;

select public.record_customer_experience_response(
  'wamid.RESPONSE_FIXTURE_1','5515999999999','wamid.REQUEST_FIXTURE_1',
  'needs_improvement','Poderia melhorar'
);

do $$
declare v_exp public.crm_customer_experience%rowtype;
declare v_job public.crm_automation_queue%rowtype;
begin
  select * into v_exp from public.crm_customer_experience where source_id='attendance-experience-fixture-1';
  if v_exp.status <> 'recovery_required' or v_exp.satisfaction <> 'needs_improvement' then
    raise exception 'negative response did not open service recovery';
  end if;
  select * into v_job from public.crm_automation_queue where event_type='service_recovery_required' and source_id=v_exp.id::text;
  if v_job.channel <> 'internal' or v_job.status <> 'pending' then
    raise exception 'recovery queue item has invalid contract';
  end if;
end $$;

update public.crm_automation_queue
set status='processing', attempts=1, locked_at=now()
where event_type='service_recovery_required'
  and source_id=(select id::text from public.crm_customer_experience where source_id='attendance-experience-fixture-1');

select public.prepare_customer_experience_recovery(
  (select id from public.crm_automation_queue where event_type='service_recovery_required' and source_id=(select id::text from public.crm_customer_experience where source_id='attendance-experience-fixture-1'))
);

do $$
declare v_exp public.crm_customer_experience%rowtype;
declare v_job public.crm_automation_queue%rowtype;
begin
  select * into v_exp from public.crm_customer_experience where source_id='attendance-experience-fixture-1';
  select * into v_job from public.crm_automation_queue where event_type='service_recovery_required' and source_id=v_exp.id::text;
  if v_exp.status <> 'recovery_in_progress' or v_job.status <> 'awaiting_operator' then
    raise exception 'recovery was not handed to operator correctly';
  end if;
  if v_job.payload #>> '{dispatch,state}' <> 'service_recovery_required' then
    raise exception 'recovery dispatch payload missing';
  end if;
end $$;

select public.resolve_customer_experience_recovery(
  (select id from public.crm_automation_queue where event_type='service_recovery_required' and source_id=(select id::text from public.crm_customer_experience where source_id='attendance-experience-fixture-1')),
  'resolved','Caso tratado com o cliente.','test_operator',null
);

do $$
declare v_exp public.crm_customer_experience%rowtype;
declare v_review public.crm_automation_queue%rowtype;
begin
  select * into v_exp from public.crm_customer_experience where source_id='attendance-experience-fixture-1';
  if v_exp.status <> 'review_pending' or v_exp.recovery_outcome <> 'resolved' or v_exp.recovery_resolved_at is null then
    raise exception 'resolved recovery did not prepare neutral review stage';
  end if;
  select * into v_review from public.crm_automation_queue where id=v_exp.review_queue_id;
  if v_review.event_type <> 'review_invitation' or v_review.channel <> 'google_review' or v_review.status <> 'pending' then
    raise exception 'neutral review invitation was not queued after recovery';
  end if;
  if v_review.scheduled_at < now() + interval '50 minutes' then
    raise exception 'review invitation should be delayed after recovery';
  end if;
end $$;

-- Duplicate source registration must remain idempotent.
select public.register_customer_experience_request(
  'attendance','attendance-experience-fixture-1','lead-fixture-1',
  '5515999999999','Maria','Pilates experimental','{}'::jsonb
);

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.crm_customer_experience
  where source_type='attendance' and source_id='attendance-experience-fixture-1';
  if v_count <> 1 then raise exception 'duplicate experience row created'; end if;
end $$;

rollback;
