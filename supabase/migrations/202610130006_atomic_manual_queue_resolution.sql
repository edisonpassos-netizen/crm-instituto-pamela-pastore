-- Resolve an operator follow-up and write its audit event in one transaction.
create or replace function public.resolve_automation_queue_manual_result(
  p_queue_id uuid,
  p_outcome text,
  p_note text default '',
  p_resolved_by text default 'crm_operator'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.crm_automation_queue%rowtype;
  v_payload jsonb;
begin
  if p_outcome not in ('contacted', 'no_answer', 'rescheduled', 'not_contacted') then
    raise exception 'Unsupported manual outcome' using errcode = '22023';
  end if;

  select * into v_job
  from public.crm_automation_queue
  where id = p_queue_id
  for update;

  if not found or v_job.status <> 'awaiting_operator' then
    return jsonb_build_object('conflict', true);
  end if;

  v_payload := jsonb_set(
    coalesce(v_job.payload, '{}'::jsonb),
    '{dispatch}',
    coalesce(v_job.payload->'dispatch', '{}'::jsonb) ||
      jsonb_build_object(
        'manual_result', p_outcome,
        'manual_note', left(coalesce(p_note, ''), 500),
        'resolved_at', now(),
        'resolved_by', left(coalesce(p_resolved_by, 'crm_operator'), 100)
      ),
    true
  );

  update public.crm_automation_queue
  set status = 'completed',
      payload = v_payload,
      locked_at = null,
      completed_at = now(),
      last_error = null,
      updated_at = now()
  where id = p_queue_id;

  insert into public.crm_automation_attempts
    (queue_id, attempt_number, outcome, detail)
  values (
    v_job.id,
    coalesce(v_job.attempts, 0),
    'skipped',
    left('Resultado manual registrado (não é confirmação de envio): ' ||
      p_outcome || '. ' || coalesce(p_note, ''), 1000)
  );

  return jsonb_build_object(
    'conflict', false,
    'item', jsonb_build_object('id', v_job.id, 'status', 'completed')
  );
end;
$$;

revoke all on function public.resolve_automation_queue_manual_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_automation_queue_manual_result(uuid, text, text, text) to service_role;
