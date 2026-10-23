begin;
do $test$
declare r jsonb; r2 jsonb; rev bigint; lid text; cnt integer;
begin
 update public.crm_app_state set data=jsonb_set(data,'{leads}','[]'),revision=revision+1 where id='main';
 select revision into rev from public.crm_app_state where id='main';
 r:=public.ingest_crm_lead_message('synthetic-lead-test-20261023-a','888888','5515999990001','Teste','text','Olá',now(),'{"referral":{"source_type":"ad"}}');
 if not (r->>'leadCreated')::boolean then raise exception 'lead not created'; end if;
 lid:=r->>'leadId';
 select jsonb_array_length(data->'leads') into cnt from public.crm_app_state where id='main';
 if cnt<>1 then raise exception 'wrong lead count'; end if;
 if (select data#>>'{leads,0,source}' from public.crm_app_state where id='main')<>'Meta Ads' then raise exception 'referral lost'; end if;
 r2:=public.ingest_crm_lead_message('synthetic-lead-test-20261023-a','888888','5515999990001','Teste','text','Olá',now(),'{}');
 if (r2->>'inserted')::boolean then raise exception 'duplicate inserted'; end if;
 if (select revision from public.crm_app_state where id='main')<>rev+1 then raise exception 'duplicate changed revision'; end if;
 r2:=public.ingest_crm_lead_message('synthetic-lead-test-20261023-b','888888','5515999990001','Novo nome','text','Outra',now(),'{}');
 if r2->>'leadId'<>lid or (r2->>'leadCreated')::boolean then raise exception 'contact duplicated'; end if;
 if (select data#>>'{leads,0,name}' from public.crm_app_state where id='main')<>'Teste' then raise exception 'overwrote name'; end if;
 if has_function_privilege('anon','public.ingest_crm_lead_message(text,text,text,text,text,text,timestamptz,jsonb)','EXECUTE') then raise exception 'anon can execute'; end if;
 if has_function_privilege('authenticated','public.ingest_crm_lead_message(text,text,text,text,text,text,timestamptz,jsonb)','EXECUTE') then raise exception 'authenticated can execute'; end if;
 if not has_function_privilege('service_role','public.ingest_crm_lead_message(text,text,text,text,text,text,timestamptz,jsonb)','EXECUTE') then raise exception 'service role denied'; end if;
 begin
   perform public.ingest_crm_lead_message('invalid-phone','888888','123','Teste','text','x',now(),'{}');
   raise exception 'invalid phone accepted';
 exception when invalid_parameter_value then null; end;
end $test$;
rollback;
