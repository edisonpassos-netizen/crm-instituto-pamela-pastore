-- Atomically finalize customer-experience outbound sends so a provider-accepted
-- message is never retried merely because post-send bookkeeping failed.
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

  return jsonb_build_object('conflict', false, 'experienceId', v_exp.id, 'status', 'sent');
end;
$$;

revoke all on function public.complete_customer_experience_send(uuid,text,text) from public, anon, authenticated;
grant execute on function public.complete_customer_experience_send(uuid,text,text) to service_role;
