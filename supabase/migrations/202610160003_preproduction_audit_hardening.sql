-- Pre-production audit hardening.
-- Additive/compatible changes only: preserve public API signatures and data.

-- Keep the legacy manual-resolution RPC hardened even though the application uses v2.
alter function public.resolve_automation_queue_manual_result(uuid, text, text, text)
  set search_path = pg_catalog, public;

create or replace function public.register_customer_experience_request(
  p_source_type text,
  p_source_id text,
  p_customer_id text,
  p_recipient_phone text,
  p_first_name text,
  p_service_name text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_phone text := regexp_replace(coalesce(p_recipient_phone, ''), '[^0-9]', '', 'g');
  v_existing public.crm_customer_experience%rowtype;
begin
  if coalesce(length(trim(p_source_type)), 0) = 0
     or coalesce(length(trim(p_source_id)), 0) = 0
     or length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Invalid customer experience source or phone' using errcode = '22023';
  end if;

  insert into public.crm_customer_experience (
    source_type, source_id, customer_id, recipient_phone,
    first_name, service_name, metadata
  ) values (
    left(trim(p_source_type), 80), left(trim(p_source_id), 160),
    nullif(left(trim(coalesce(p_customer_id, '')), 160), ''), v_phone,
    nullif(left(trim(coalesce(p_first_name, '')), 120), ''),
    nullif(left(trim(coalesce(p_service_name, '')), 200), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_type, source_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select * into v_existing
  from public.crm_customer_experience
  where source_type = left(trim(p_source_type), 80)
    and source_id = left(trim(p_source_id), 160)
  for update;

  if not found then
    raise exception 'Customer experience row disappeared during registration';
  end if;

  -- A retry may correct data only before anything has been sent. Once the
  -- workflow advances, keep its historical customer/service snapshot immutable.
  if v_existing.status = 'pending_send' then
    update public.crm_customer_experience
    set customer_id = nullif(left(trim(coalesce(p_customer_id, '')), 160), ''),
        recipient_phone = v_phone,
        first_name = nullif(left(trim(coalesce(p_first_name, '')), 120), ''),
        service_name = nullif(left(trim(coalesce(p_service_name, '')), 200), ''),
        metadata = public.crm_customer_experience.metadata || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = v_existing.id;
  end if;

  return v_existing.id;
end;
$$;

create or replace function public.complete_customer_experience_send(
  p_queue_id uuid,
  p_provider_message_id text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.crm_automation_queue%rowtype;
  v_exp public.crm_customer_experience%rowtype;
  v_provider_id text := nullif(left(trim(coalesce(p_provider_message_id, '')), 255), '');
begin
  if p_kind not in ('satisfaction_request','review_invitation') then
    raise exception 'Unsupported customer experience send kind' using errcode = '22023';
  end if;
  if v_provider_id is null then
    raise exception 'Provider message id is required to finalize a send' using errcode = '22023';
  end if;

  select * into v_job
  from public.crm_automation_queue
  where id = p_queue_id
  for update;

  if not found or v_job.status <> 'processing'
     or v_job.source_type <> 'customer_experience'
     or v_job.event_type <> p_kind then
    return jsonb_build_object('conflict', true, 'reason', 'queue_state');
  end if;

  select * into v_exp
  from public.crm_customer_experience
  where id::text = v_job.source_id
  for update;

  if not found then
    return jsonb_build_object('conflict', true, 'reason', 'experience_missing');
  end if;

  if p_kind = 'satisfaction_request' and v_exp.status <> 'pending_send' then
    return jsonb_build_object('conflict', true, 'reason', 'experience_state');
  end if;
  if p_kind = 'review_invitation' and v_exp.status not in ('review_pending','recovery_resolved') then
    return jsonb_build_object('conflict', true, 'reason', 'experience_state');
  end if;

  update public.crm_automation_queue
  set status = 'sent',
      locked_at = null,
      provider_message_id = v_provider_id,
      completed_at = now(),
      last_error = null,
      updated_at = now()
  where id = v_job.id;

  if p_kind = 'satisfaction_request' then
    update public.crm_customer_experience
    set status = 'awaiting_response',
        request_queue_id = v_job.id,
        request_provider_message_id = v_provider_id,
        requested_at = coalesce(requested_at, now()),
        updated_at = now()
    where id = v_exp.id;
  else
    update public.crm_customer_experience
    set status = 'review_invited',
        review_queue_id = v_job.id,
        review_invited_at = coalesce(review_invited_at, now()),
        metadata = metadata || jsonb_build_object('review_provider_message_id', v_provider_id),
        updated_at = now()
    where id = v_exp.id;
  end if;

  -- Persist the successful provider correlation in the same transaction as the
  -- queue/experience state, minimizing status-webhook races.
  insert into public.crm_automation_attempts(
    queue_id, attempt_number, outcome, detail, provider_message_id
  ) values (
    v_job.id,
    coalesce(v_job.attempts, 0),
    'succeeded',
    'Aceito pela API oficial do WhatsApp e conciliado com a experiência.',
    v_provider_id
  )
  on conflict (queue_id, attempt_number, outcome) do update
    set detail = excluded.detail,
        provider_message_id = excluded.provider_message_id;

  return jsonb_build_object(
    'conflict', false,
    'experienceId', v_exp.id,
    'status', 'sent',
    'attemptLogged', true
  );
end;
$$;

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
  if p_satisfaction not in ('very_good','good','needs_improvement') then
    raise exception 'Unsupported satisfaction value' using errcode = '22023';
  end if;
  if length(v_response_id) = 0 or length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Invalid customer experience response identifiers' using errcode = '22023';
  end if;

  if length(v_context_id) > 0 then
    select * into v_exp
    from public.crm_customer_experience
    where status = 'awaiting_response'
      and recipient_phone = v_phone
      and request_provider_message_id = v_context_id
    order by requested_at desc nulls last, created_at desc
    limit 1
    for update;
  else
    select array_agg(id order by requested_at desc nulls last, created_at desc)
      into v_candidate_ids
    from public.crm_customer_experience
    where status = 'awaiting_response'
      and recipient_phone = v_phone
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
    return jsonb_build_object('matched', true, 'duplicate', true, 'experienceId', v_exp.id);
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
