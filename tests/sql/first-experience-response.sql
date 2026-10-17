\set ON_ERROR_STOP on
begin;

do $$
declare
  v_a uuid; v_b uuid; v_c uuid; v_result jsonb; v_count integer;
  v_before jsonb; v_after jsonb;
begin
  v_a := public.register_customer_experience_request('homologation','first-answer-regression-a',null,'5515997601234','Teste','Resposta única','{"test":true}'::jsonb);
  v_b := public.register_customer_experience_request('homologation','first-answer-regression-b',null,'5515997601234','Teste','Resposta única','{"test":true}'::jsonb);
  v_c := public.register_customer_experience_request('homologation','first-answer-regression-c',null,'5515997601234','Teste','Resposta única','{"test":true}'::jsonb);
  update public.crm_customer_experience
  set status='awaiting_response', requested_at=now(), request_provider_message_id='regression-request-'||id::text
  where id in (v_a,v_b,v_c);

  v_result := public.record_customer_experience_response('regression-response-a','5515997601234','regression-request-'||v_a::text,'good','Boa');
  if v_result->>'action' <> 'review_queued' then raise exception 'first positive answer failed: %',v_result; end if;
  select to_jsonb(e) into v_before from public.crm_customer_experience e where id=v_a;
  v_result := public.record_customer_experience_response('regression-response-a-second','5515997601234','regression-request-'||v_a::text,'needs_improvement','Poderia melhorar');
  if v_result->>'duplicate' is distinct from 'true' or v_result->>'action' <> 'none' then raise exception 'second button not ignored: %',v_result; end if;
  select to_jsonb(e) into v_after from public.crm_customer_experience e where id=v_a;
  if v_before is distinct from v_after then raise exception 'second click changed first answer'; end if;
  select count(*) into v_count from public.crm_automation_queue where source_type='customer_experience' and source_id=v_a::text;
  if v_count <> 1 then raise exception 'second click generated extra work'; end if;

  -- The old message cannot answer a different pending survey.
  v_result := public.record_customer_experience_response('regression-response-a','5515997601234',null,'good','Boa');
  if v_result->>'duplicate' is distinct from 'true' then raise exception 'context-free replay not recognized'; end if;
  if exists(select 1 from public.crm_customer_experience where id in(v_b,v_c) and satisfaction is not null) then raise exception 'replay contaminated another survey'; end if;
  v_result := public.record_customer_experience_response('regression-context-free-new','5515997601234',null,'good','Boa');
  if v_result->>'ambiguous' is distinct from 'true' then raise exception 'ambiguous response accepted'; end if;

  v_result := public.record_customer_experience_response('regression-response-b','5515997601234','regression-request-'||v_b::text,'needs_improvement','Poderia melhorar');
  if v_result->>'action' <> 'recovery_queued' then raise exception 'negative answer failed'; end if;
  select to_jsonb(e) into v_before from public.crm_customer_experience e where id=v_b;
  v_result := public.record_customer_experience_response('regression-response-b-second','5515997601234','regression-request-'||v_b::text,'very_good','Excelente');
  if v_result->>'duplicate' is distinct from 'true' then raise exception 'positive after negative was accepted'; end if;
  select to_jsonb(e) into v_after from public.crm_customer_experience e where id=v_b;
  if v_before is distinct from v_after then raise exception 'recovery changed by second click'; end if;
  select count(*) into v_count from public.crm_automation_queue where source_type='customer_experience' and source_id=v_b::text;
  if v_count <> 1 then raise exception 'negative repeat generated extra work'; end if;

  v_result := public.record_customer_experience_response('regression-response-c','5515997601234','regression-request-'||v_c::text,'very_good','Excelente');
  if v_result->>'action' <> 'review_queued' then raise exception 'new explicit survey could not be answered'; end if;
  if has_function_privilege('anon','public.record_customer_experience_response(text,text,text,text,text)','execute') or has_function_privilege('authenticated','public.record_customer_experience_response(text,text,text,text,text)','execute') then raise exception 'public execution exposed'; end if;
end $$;

rollback;

