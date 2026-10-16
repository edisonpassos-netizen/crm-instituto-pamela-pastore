-- V3 keeps V2 available for rollback/legacy callers while adding an optional
-- local requested time to rescheduled follow-ups.
create or replace function public.resolve_automation_queue_manual_result_v3(
  p_queue_id uuid,
  p_outcome text,
  p_note text default '',
  p_resolved_by text default 'crm_operator',
  p_reschedule_date date default null,
  p_reschedule_time text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_job public.crm_automation_queue%rowtype;
  v_state public.crm_app_state%rowtype;
  v_payload jsonb;
  v_tasks jsonb;
  v_task jsonb;
  v_task_id text;
  v_new_task_id text;
  v_new_task jsonb;
  v_new_queue_id uuid;
  v_revision bigint;
  v_time text;
begin
  if p_outcome not in ('contacted', 'no_answer', 'rescheduled', 'not_contacted') then
    raise exception 'Unsupported manual outcome' using errcode = '22023';
  end if;

  v_time := nullif(btrim(coalesce(p_reschedule_time, '')), '');

  if p_outcome = 'rescheduled' then
    if p_reschedule_date is null or p_reschedule_date < current_date then
      raise exception 'Reschedule date must be today or later' using errcode = '22023';
    end if;
    if v_time is not null and v_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Reschedule time must be HH:MM' using errcode = '22023';
    end if;
  else
    v_time := null;
  end if;

  select * into v_job
  from public.crm_automation_queue
  where id = p_queue_id
  for update;

  if not found or v_job.status <> 'awaiting_operator' then
    return jsonb_build_object('conflict', true, 'reason', 'queue_state');
  end if;

  if v_job.channel <> 'internal' or v_job.event_type <> 'lead_follow_up_requested' or v_job.source_type <> 'task' then
    return jsonb_build_object('conflict', true, 'reason', 'unsupported_queue_item');
  end if;

  v_task_id := coalesce(v_job.payload #>> '{dispatch,task_id}', v_job.source_id);

  select * into v_state
  from public.crm_app_state
  where id = 'main'
  for update;

  if not found then
    raise exception 'CRM state not found' using errcode = 'P0002';
  end if;

  select task into v_task
  from jsonb_array_elements(coalesce(v_state.data->'tasks', '[]'::jsonb)) as x(task)
  where task->>'id' = v_task_id
  limit 1;

  if v_task is null then
    return jsonb_build_object('conflict', true, 'reason', 'task_not_found');
  end if;

  select coalesce(jsonb_agg(
    case
      when task->>'id' = v_task_id then task || jsonb_build_object(
        'done', true,
        'completedAt', now(),
        'manualOutcome', p_outcome,
        'manualNote', left(coalesce(p_note, ''), 500)
      )
      else task
    end
    order by ord
  ), '[]'::jsonb)
  into v_tasks
  from jsonb_array_elements(coalesce(v_state.data->'tasks', '[]'::jsonb)) with ordinality as x(task, ord);

  if p_outcome = 'rescheduled' then
    v_new_task_id := gen_random_uuid()::text;
    v_new_task := jsonb_build_object(
      'id', v_new_task_id,
      'leadId', v_task->>'leadId',
      'date', p_reschedule_date::text,
      'type', coalesce(nullif(v_task->>'type', ''), 'Retorno'),
      'note', left(case when coalesce(p_note, '') = '' then 'Retorno reagendado' else p_note end, 500),
      'done', false
    );
    if v_time is not null then
      v_new_task := v_new_task || jsonb_build_object('time', v_time);
    end if;
    v_tasks := v_tasks || jsonb_build_array(v_new_task);
  end if;

  v_revision := v_state.revision + 1;
  update public.crm_app_state
  set data = jsonb_set(v_state.data, '{tasks}', v_tasks, true),
      revision = v_revision,
      updated_at = now(),
      updated_by = 'automation-manual-result-v3'
  where id = 'main';

  v_payload := jsonb_set(
    coalesce(v_job.payload, '{}'::jsonb),
    '{dispatch}',
    coalesce(v_job.payload->'dispatch', '{}'::jsonb) || jsonb_build_object(
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

  insert into public.crm_automation_attempts(queue_id, attempt_number, outcome, detail)
  values (
    v_job.id,
    coalesce(v_job.attempts, 0),
    'skipped',
    left('Resultado manual registrado (não é confirmação de envio): ' || p_outcome || '. ' || coalesce(p_note, ''), 1000)
  );

  if p_outcome = 'rescheduled' then
    v_new_queue_id := public.enqueue_crm_automation(
      'crm:lead_follow_up_requested:task:' || v_new_task_id,
      'lead_follow_up_requested',
      'task',
      v_new_task_id,
      null,
      jsonb_build_object(
        'source_type', 'task',
        'source_id', v_new_task_id,
        'occurred_at', now(),
        'task', 'follow_up_lead',
        'rescheduled_from', v_task_id
      ),
      'internal',
      now(),
      3
    );
  end if;

  return jsonb_build_object(
    'conflict', false,
    'item', jsonb_build_object('id', v_job.id, 'status', 'completed'),
    'appRevision', v_revision,
    'rescheduledTaskId', v_new_task_id,
    'rescheduledQueueId', v_new_queue_id,
    'rescheduleDate', case when p_reschedule_date is null then null else p_reschedule_date::text end,
    'rescheduleTime', v_time
  );
end;
$function$;

revoke all on function public.resolve_automation_queue_manual_result_v3(uuid, text, text, text, date, text) from public;
revoke all on function public.resolve_automation_queue_manual_result_v3(uuid, text, text, text, date, text) from anon;
revoke all on function public.resolve_automation_queue_manual_result_v3(uuid, text, text, text, date, text) from authenticated;
grant execute on function public.resolve_automation_queue_manual_result_v3(uuid, text, text, text, date, text) to service_role;
