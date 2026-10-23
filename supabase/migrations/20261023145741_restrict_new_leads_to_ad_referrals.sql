create or replace function public.ingest_crm_lead_message(
  p_provider_message_id text, p_phone_number_id text, p_contact_wa_id text,
  p_contact_name text, p_message_type text, p_text_body text,
  p_provider_timestamp timestamptz, p_message_payload jsonb
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public as $$
declare
  v_result jsonb; v_state jsonb; v_leads jsonb; v_lead jsonb; v_index integer;
  v_phone text; v_matches integer; v_lead_id text; v_created boolean := false;
begin
  v_phone := regexp_replace(coalesce(p_contact_wa_id,''), '[^0-9]', '', 'g');
  if v_phone !~ '^55[1-9][0-9][0-9]{8,9}$' then
    raise exception 'Invalid Brazilian WhatsApp contact' using errcode='22023';
  end if;
  v_result := public.ingest_whatsapp_inbound_message(
    p_provider_message_id,p_phone_number_id,v_phone,p_contact_name,
    p_message_type,p_text_body,p_provider_timestamp,p_message_payload);
  if not coalesce((v_result->>'inserted')::boolean,false) then
    return v_result || jsonb_build_object('leadCreated',false);
  end if;
  select data into strict v_state from public.crm_app_state where id='main' for update;
  v_leads := coalesce(v_state->'leads','[]'::jsonb);
  if jsonb_typeof(v_leads) <> 'array' then
    raise exception 'Invalid CRM leads state' using errcode='22023';
  end if;
  select count(*),min((ordinality-1)::integer) into v_matches,v_index
    from jsonb_array_elements(v_leads) with ordinality x(item,ordinality)
    where (case when length(regexp_replace(coalesce(item->>'phone',''),'[^0-9]','','g')) in (10,11)
      then '55'||regexp_replace(coalesce(item->>'phone',''),'[^0-9]','','g')
      else regexp_replace(coalesce(item->>'phone',''),'[^0-9]','','g') end)=v_phone;
  if v_matches > 1 then
    return v_result || jsonb_build_object('leadCreated',false,'leadAssociationAmbiguous',true);
  end if;
  if v_matches=0 and p_message_payload#>>'{referral,source_type}' is distinct from 'ad' then
    return v_result || jsonb_build_object('leadCreated',false,'leadSkippedReason','ad_referral_required');
  end if;
  if v_matches=0 then
    v_lead_id := gen_random_uuid()::text;
    v_created := true;
    v_lead := jsonb_build_object(
      'id',v_lead_id,'name',coalesce(nullif(left(trim(p_contact_name),200),''),'Contato WhatsApp'),
      'phone',v_phone,'email','','service','Pilates',
      'source',case when p_message_payload#>>'{referral,source_type}'='ad' then 'Meta Ads' else 'WhatsApp' end,
      'campaign','','status','Novo lead','temperature','Morno','notes','',
      'createdAt',now(),'interest',false,'priceAsked',false,'requestedTime',false,
      'appointment',false,'attended',false,'bought',false);
  else
    v_lead := v_leads->v_index;
    v_lead_id := v_lead->>'id';
  end if;
  v_lead := v_lead || jsonb_build_object('whatsappPhoneNumberId',p_phone_number_id,
    'whatsappLastMessageAt',coalesce(p_provider_timestamp,now()),
    'whatsappLastMessageId',left(p_provider_message_id,255));
  if v_created then v_leads := jsonb_build_array(v_lead)||v_leads;
  else v_leads := jsonb_set(v_leads,array[v_index::text],v_lead); end if;
  update public.crm_app_state set data=jsonb_set(v_state,'{leads}',v_leads),
    revision=revision+1,updated_at=now(),updated_by='whatsapp-inbound' where id='main';
  return v_result || jsonb_build_object('leadId',v_lead_id,'leadCreated',v_created);
end $$;
revoke all on function public.ingest_crm_lead_message(text,text,text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_crm_lead_message(text,text,text,text,text,text,timestamptz,jsonb) to service_role;
