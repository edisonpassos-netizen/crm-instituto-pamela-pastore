\set ON_ERROR_STOP on

begin;

-- A send must never be finalized without a provider correlation id.
select public.register_customer_experience_request(
  'attendance','audit-provider-id','lead-audit',
  '5515991111111','Maria','Pilates','{}'::jsonb
);

select public.enqueue_crm_automation(
  'crm:satisfaction_request:experience:' || (
    select id::text from public.crm_customer_experience where source_id='audit-provider-id'
  ),
  'satisfaction_request','customer_experience',
  (select id::text from public.crm_customer_experience where source_id='audit-provider-id'),
  '5515991111111','{}'::jsonb,'whatsapp',now(),3
);

update public.crm_automation_queue
set status='processing', attempts=1, locked_at=now()
where event_type='satisfaction_request'
  and source_id=(select id::text from public.crm_customer_experience where source_id='audit-provider-id');

do $$
begin
  perform public.complete_customer_experience_send(
    (select id from public.crm_automation_queue where event_type='satisfaction_request' and source_id=(select id::text from public.crm_customer_experience where source_id='audit-provider-id')),
    null,'satisfaction_request'
  );
  raise exception 'blank provider id should have been rejected';
exception
  when sqlstate '22023' then null;
end $$;

select public.complete_customer_experience_send(
  (select id from public.crm_automation_queue where event_type='satisfaction_request' and source_id=(select id::text from public.crm_customer_experience where source_id='audit-provider-id')),
  'wamid.AUDIT_PROVIDER_1','satisfaction_request'
);

do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.crm_automation_attempts a
  join public.crm_automation_queue q on q.id=a.queue_id
  where q.source_id=(select id::text from public.crm_customer_experience where source_id='audit-provider-id')
    and a.outcome='succeeded'
    and a.provider_message_id='wamid.AUDIT_PROVIDER_1';
  if v_count <> 1 then raise exception 'successful provider correlation was not logged atomically'; end if;
end $$;

-- Once a request has left pending_send, duplicate registration may not mutate
-- the historical customer/service snapshot.
select public.register_customer_experience_request(
  'attendance','audit-provider-id','lead-changed',
  '5515988888888','Alterada','Outro','{"changed":true}'::jsonb
);

do $$
declare v_exp public.crm_customer_experience%rowtype;
begin
  select * into v_exp from public.crm_customer_experience where source_id='audit-provider-id';
  if v_exp.recipient_phone <> '5515991111111' or v_exp.first_name <> 'Maria' or v_exp.service_name <> 'Pilates' then
    raise exception 'historical experience snapshot was mutated after send';
  end if;
end $$;

-- Without a WhatsApp context id, a phone fallback is only safe when exactly
-- one survey is awaiting response in the seven-day window.
select public.register_customer_experience_request(
  'attendance','audit-ambiguous-a','lead-a','5515992222222','Ana','Pilates','{}'::jsonb
);
select public.register_customer_experience_request(
  'attendance','audit-ambiguous-b','lead-b','5515992222222','Ana','Estética','{}'::jsonb
);

update public.crm_customer_experience
set status='awaiting_response', requested_at=now(),
    request_provider_message_id=case source_id when 'audit-ambiguous-a' then 'wamid.AUDIT_A' else 'wamid.AUDIT_B' end
where source_id in ('audit-ambiguous-a','audit-ambiguous-b');

do $$
declare v_result jsonb; v_count integer;
begin
  v_result := public.record_customer_experience_response(
    'wamid.AUDIT_RESPONSE_AMBIGUOUS','5515992222222',null,'good','Boa'
  );
  if coalesce((v_result->>'ambiguous')::boolean,false) is not true or coalesce((v_result->>'matched')::boolean,true) is not false then
    raise exception 'ambiguous phone-only response was not rejected safely: %', v_result;
  end if;
  select count(*) into v_count from public.crm_customer_experience
  where source_id in ('audit-ambiguous-a','audit-ambiguous-b') and satisfaction is not null;
  if v_count <> 0 then raise exception 'ambiguous response modified an experience'; end if;
end $$;

-- Explicit WhatsApp context still resolves deterministically.
select public.record_customer_experience_response(
  'wamid.AUDIT_RESPONSE_EXACT','5515992222222','wamid.AUDIT_A','good','Boa'
);

do $$
declare v_sat text;
begin
  select satisfaction into v_sat from public.crm_customer_experience where source_id='audit-ambiguous-a';
  if v_sat <> 'good' then raise exception 'exact context response did not resolve the intended experience'; end if;
end $$;

rollback;
