-- First accepted answer is final; later clicks have no side effects.
create or replace function public.record_customer_experience_response(
  p_provider_message_id text,
  p_contact_wa_id text,
  p_context_provider_message_id text,
  p_satisfaction text,
  p_response_text text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_exp public.crm_customer_experience%rowtype;
  v_queue_id uuid;
  v_phone text := regexp_replace(coalesce(p_contact_wa_id, ''), '[^0-9]', '', 'g');
  v_response_id text := left(trim(coalesce(p_provider_message_id, '')), 255);
  v_context_id text := left(trim(coalesce(p_context_provider_message_id, '')), 255);
  v_candidate_ids uuid[];
begin
  if p_satisfaction is null or p_satisfaction not in ('very_good','good','needs_improvement') then
    raise exception 'Unsupported satisfaction value' using errcode = '22023';
  end if;
  if length(v_response_id) = 0 or length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Invalid customer experience response identifiers' using errcode = '22023';
  end if;

  -- A replay cannot be reassigned to a newer survey, even without context.
  select * into v_exp from public.crm_customer_experience
  where recipient_phone = v_phone and response_provider_message_id = v_response_id
  limit 1;
  if found then
    return jsonb_build_object('matched', true, 'duplicate', true, 'action', 'none', 'experienceId', v_exp.id);
  end if;

  if length(v_context_id) > 0 then
    select * into v_exp
    from public.crm_customer_experience
    where recipient_phone = v_phone
      and request_provider_message_id = v_context_id
    order by requested_at desc nulls last, created_at desc
    limit 1
    for update;
  else
    -- Include answered surveys so absent context cannot redirect an old click.
    select array_agg(id order by requested_at desc nulls last, created_at desc)
      into v_candidate_ids
    from public.crm_customer_experience
    where recipient_phone = v_phone
      and requested_at >= now() - interval '7 days';

    if coalesce(cardinality(v_candidate_ids), 0) > 1 then
      return jsonb_build_object('matched', false, 'ambiguous', true, 'action', 'none');
    end if;
    if coalesce(cardinality(v_candidate_ids), 0) = 1 then
      select * into v_exp
      from public.crm_customer_experience
      where id = v_candidate_ids[1]
      for update;
    end if;
  end if;

  if v_exp.id is null then
    return jsonb_build_object('matched', false, 'action', 'none');
  end if;

  if v_exp.response_provider_message_id is not null then
    return jsonb_build_object('matched', true, 'duplicate', true, 'action', 'none', 'experienceId', v_exp.id);
  end if;

  -- Recheck state after the row lock, including concurrent responses.
  if v_exp.status <> 'awaiting_response' then
    return jsonb_build_object('matched', false, 'action', 'none');
  end if;

  update public.crm_customer_experience
  set satisfaction = p_satisfaction,
      response_text = left(coalesce(p_response_text, ''), 1000),
      response_provider_message_id = v_response_id,
      responded_at = now(),
      updated_at = now()
  where id = v_exp.id;

  if p_satisfaction = 'needs_improvement' then
    v_queue_id := public.enqueue_crm_automation(
      'crm:service_recovery_required:experience:' || v_exp.id::text,
      'service_recovery_required',
      'customer_experience',
      v_exp.id::text,
      null,
      jsonb_build_object(
        'experience_id', v_exp.id,
        'customer_id', v_exp.customer_id,
        'first_name', v_exp.first_name,
        'service_name', v_exp.service_name,
        'recipient_phone', v_exp.recipient_phone,
        'response_text', left(coalesce(p_response_text, ''), 1000),
        'satisfaction', p_satisfaction
      ),
      'internal',
      now(),
      3
    );

    update public.crm_customer_experience
    set status = 'recovery_required',
        recovery_queue_id = v_queue_id,
        recovery_opened_at = coalesce(recovery_opened_at, now()),
        updated_at = now()
    where id = v_exp.id;

    return jsonb_build_object(
      'matched', true, 'action', 'recovery_queued',
      'experienceId', v_exp.id, 'queueId', v_queue_id
    );
  end if;

  v_queue_id := public.enqueue_crm_automation(
    'crm:review_invitation:experience:' || v_exp.id::text,
    'review_invitation',
    'customer_experience',
    v_exp.id::text,
    v_exp.recipient_phone,
    jsonb_build_object(
      'experience_id', v_exp.id,
      'customer_id', v_exp.customer_id,
      'first_name', v_exp.first_name,
      'service_name', v_exp.service_name,
      'satisfaction', p_satisfaction
    ),
    'google_review',
    now(),
    3
  );

  update public.crm_customer_experience
  set status = 'review_pending',
      review_queue_id = v_queue_id,
      updated_at = now()
  where id = v_exp.id;

  return jsonb_build_object(
    'matched', true, 'action', 'review_queued',
    'experienceId', v_exp.id, 'queueId', v_queue_id
  );
end;
$$;

revoke all on function public.record_customer_experience_response(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_customer_experience_response(text,text,text,text,text) to service_role;

