-- Customer experience and service-recovery workflow.
-- This migration is additive and does not enable any outbound automation.

create table if not exists public.crm_customer_experience (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  customer_id text,
  recipient_phone text not null,
  first_name text,
  service_name text,
  status text not null default 'pending_send'
    check (status in (
      'pending_send','awaiting_response','review_pending',
      'recovery_required','recovery_in_progress','recovery_resolved',
      'review_invited','closed'
    )),
  satisfaction text
    check (satisfaction is null or satisfaction in ('very_good','good','needs_improvement')),
  response_text text,
  request_queue_id uuid references public.crm_automation_queue(id) on delete set null,
  request_provider_message_id text,
  response_provider_message_id text,
  recovery_queue_id uuid references public.crm_automation_queue(id) on delete set null,
  review_queue_id uuid references public.crm_automation_queue(id) on delete set null,
  requested_at timestamptz,
  responded_at timestamptz,
  recovery_opened_at timestamptz,
  recovery_resolved_at timestamptz,
  recovery_outcome text,
  recovery_note text,
  review_invited_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create unique index if not exists crm_customer_experience_request_provider_uidx
  on public.crm_customer_experience(request_provider_message_id)
  where request_provider_message_id is not null;
create unique index if not exists crm_customer_experience_response_provider_uidx
  on public.crm_customer_experience(response_provider_message_id)
  where response_provider_message_id is not null;
create index if not exists crm_customer_experience_phone_idx
  on public.crm_customer_experience(recipient_phone, requested_at desc);
create index if not exists crm_customer_experience_status_idx
  on public.crm_customer_experience(status, updated_at desc);

alter table public.crm_customer_experience enable row level security;
revoke all on table public.crm_customer_experience from public, anon, authenticated;
grant select, insert, update on table public.crm_customer_experience to service_role;

drop policy if exists "deny public access to crm customer experience" on public.crm_customer_experience;
create policy "deny public access to crm customer experience"
on public.crm_customer_experience
for all
to anon, authenticated
using (false)
with check (false);

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
  on conflict (source_type, source_id) do update
    set customer_id = excluded.customer_id,
        recipient_phone = excluded.recipient_phone,
        first_name = excluded.first_name,
        service_name = excluded.service_name,
        metadata = public.crm_customer_experience.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.mark_customer_experience_request_sent(
  p_experience_id uuid,
  p_queue_id uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.crm_customer_experience
  set status = 'awaiting_response',
      request_queue_id = p_queue_id,
      request_provider_message_id = nullif(left(trim(coalesce(p_provider_message_id, '')), 255), ''),
      requested_at = coalesce(requested_at, now()),
      updated_at = now()
  where id = p_experience_id
    and status in ('pending_send','awaiting_response');
  return found;
end;
$$;

create or replace function public.mark_customer_experience_review_invited(
  p_experience_id uuid,
  p_queue_id uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.crm_customer_experience
  set status = 'review_invited',
      review_queue_id = p_queue_id,
      review_invited_at = coalesce(review_invited_at, now()),
      metadata = metadata || jsonb_build_object(
        'review_provider_message_id', nullif(left(trim(coalesce(p_provider_message_id, '')), 255), '')
      ),
      updated_at = now()
  where id = p_experience_id
    and status in ('review_pending','recovery_resolved','review_invited');
  return found;
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
begin
  if p_satisfaction not in ('very_good','good','needs_improvement') then
    raise exception 'Unsupported satisfaction value' using errcode = '22023';
  end if;
  if length(v_response_id) = 0 or length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Invalid customer experience response identifiers' using errcode = '22023';
  end if;

  select * into v_exp
  from public.crm_customer_experience
  where status = 'awaiting_response'
    and recipient_phone = v_phone
    and (
      (coalesce(length(trim(p_context_provider_message_id)), 0) > 0
       and request_provider_message_id = left(trim(p_context_provider_message_id), 255))
      or
      (coalesce(length(trim(p_context_provider_message_id)), 0) = 0
       and requested_at >= now() - interval '7 days')
    )
  order by
    case when request_provider_message_id = left(trim(coalesce(p_context_provider_message_id, '')), 255) then 0 else 1 end,
    requested_at desc nulls last,
    created_at desc
  limit 1
  for update;

  if not found then
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

create or replace function public.prepare_customer_experience_recovery(
  p_queue_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.crm_automation_queue%rowtype;
  v_exp public.crm_customer_experience%rowtype;
  v_payload jsonb;
begin
  select * into v_job
  from public.crm_automation_queue
  where id = p_queue_id
  for update;

  if not found or v_job.status <> 'processing'
     or v_job.channel <> 'internal'
     or v_job.event_type <> 'service_recovery_required'
     or v_job.source_type <> 'customer_experience' then
    return jsonb_build_object('conflict', true, 'reason', 'queue_state');
  end if;

  select * into v_exp
  from public.crm_customer_experience
  where id::text = v_job.source_id
  for update;

  if not found or v_exp.status not in ('recovery_required','recovery_in_progress') then
    return jsonb_build_object('conflict', true, 'reason', 'experience_state');
  end if;

  v_payload := coalesce(v_job.payload, '{}'::jsonb) || jsonb_build_object(
    'dispatch', jsonb_build_object(
      'state', 'service_recovery_required',
      'experience_id', v_exp.id,
      'lead_name', coalesce(v_exp.first_name, 'Cliente'),
      'recipient_phone', v_exp.recipient_phone,
      'task_type', 'Recuperação de experiência',
      'service_name', coalesce(v_exp.service_name, 'Atendimento'),
      'note', left(coalesce(v_exp.response_text, 'Cliente informou que a experiência poderia melhorar.'), 500),
      'prepared_at', now()
    )
  );

  update public.crm_automation_queue
  set status = 'awaiting_operator',
      payload = v_payload,
      locked_at = null,
      last_error = null,
      updated_at = now()
  where id = v_job.id;

  update public.crm_customer_experience
  set status = 'recovery_in_progress',
      recovery_queue_id = v_job.id,
      updated_at = now()
  where id = v_exp.id;

  return jsonb_build_object('conflict', false, 'experienceId', v_exp.id, 'item', v_payload->'dispatch');
end;
$$;

create or replace function public.resolve_customer_experience_recovery(
  p_queue_id uuid,
  p_outcome text,
  p_note text default '',
  p_resolved_by text default 'crm_operator',
  p_reschedule_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.crm_automation_queue%rowtype;
  v_exp public.crm_customer_experience%rowtype;
  v_review_queue_id uuid;
  v_scheduled_at timestamptz;
begin
  if p_outcome not in ('resolved','unresolved','rescheduled') then
    raise exception 'Unsupported recovery outcome' using errcode = '22023';
  end if;

  if p_outcome = 'rescheduled' and (p_reschedule_date is null or p_reschedule_date < current_date) then
    raise exception 'Reschedule date must be today or later' using errcode = '22023';
  end if;

  select * into v_job
  from public.crm_automation_queue
  where id = p_queue_id
  for update;

  if not found or v_job.status <> 'awaiting_operator'
     or v_job.channel <> 'internal'
     or v_job.event_type <> 'service_recovery_required'
     or v_job.source_type <> 'customer_experience' then
    return jsonb_build_object('conflict', true, 'reason', 'queue_state');
  end if;

  select * into v_exp
  from public.crm_customer_experience
  where id::text = v_job.source_id
  for update;

  if not found or v_exp.status <> 'recovery_in_progress' then
    return jsonb_build_object('conflict', true, 'reason', 'experience_state');
  end if;

  if p_outcome = 'rescheduled' then
    v_scheduled_at := p_reschedule_date::timestamp + time '12:00';
    update public.crm_automation_queue
    set status = 'pending',
        scheduled_at = v_scheduled_at,
        locked_at = null,
        last_error = null,
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'last_manual_note', left(coalesce(p_note, ''), 500),
          'rescheduled_by', left(coalesce(p_resolved_by, 'crm_operator'), 100),
          'rescheduled_at', now()
        ),
        updated_at = now()
    where id = v_job.id;

    update public.crm_customer_experience
    set recovery_note = left(coalesce(p_note, ''), 1000),
        updated_at = now()
    where id = v_exp.id;

    return jsonb_build_object(
      'conflict', false, 'rescheduled', true,
      'experienceId', v_exp.id, 'rescheduleDate', p_reschedule_date::text
    );
  end if;

  update public.crm_automation_queue
  set status = 'completed',
      locked_at = null,
      completed_at = now(),
      last_error = null,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'recovery_outcome', p_outcome,
        'recovery_note', left(coalesce(p_note, ''), 500),
        'resolved_by', left(coalesce(p_resolved_by, 'crm_operator'), 100),
        'resolved_at', now()
      ),
      updated_at = now()
  where id = v_job.id;

  v_review_queue_id := public.enqueue_crm_automation(
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
      'recovery_outcome', p_outcome
    ),
    'google_review',
    now() + interval '1 hour',
    3
  );

  update public.crm_customer_experience
  set status = 'review_pending',
      recovery_outcome = p_outcome,
      recovery_note = left(coalesce(p_note, ''), 1000),
      recovery_resolved_at = now(),
      review_queue_id = v_review_queue_id,
      updated_at = now()
  where id = v_exp.id;

  insert into public.crm_automation_attempts(queue_id, attempt_number, outcome, detail)
  values (
    v_job.id,
    coalesce(v_job.attempts, 0),
    'skipped',
    left('Recuperação registrada manualmente: ' || p_outcome || '. ' || coalesce(p_note, ''), 1000)
  )
  on conflict do nothing;

  return jsonb_build_object(
    'conflict', false,
    'experienceId', v_exp.id,
    'reviewQueueId', v_review_queue_id,
    'reviewScheduled', true
  );
end;
$$;

revoke all on function public.register_customer_experience_request(text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.mark_customer_experience_request_sent(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.mark_customer_experience_review_invited(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.record_customer_experience_response(text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.prepare_customer_experience_recovery(uuid) from public, anon, authenticated;
revoke all on function public.resolve_customer_experience_recovery(uuid,text,text,text,date) from public, anon, authenticated;

grant execute on function public.register_customer_experience_request(text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.mark_customer_experience_request_sent(uuid,uuid,text) to service_role;
grant execute on function public.mark_customer_experience_review_invited(uuid,uuid,text) to service_role;
grant execute on function public.record_customer_experience_response(text,text,text,text,text) to service_role;
grant execute on function public.prepare_customer_experience_recovery(uuid) to service_role;
grant execute on function public.resolve_customer_experience_recovery(uuid,text,text,text,date) to service_role;
