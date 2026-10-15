-- End-to-end database assertions for manual follow-up resolution.
-- Runs against an ephemeral PostgreSQL database only.
begin;

\ir ../../supabase/migrations/202610090001_create_crm_app_state.sql
\ir ../../supabase/migrations/20261015193500_manual_result_task_sync.sql

do $$
declare
  v_id uuid;
  v_id_reschedule uuid;
  v_result jsonb;
  v_row public.crm_automation_queue%rowtype;
  v_attempt_count integer;
  v_invalid_rejected boolean := false;
  v_bad_date_rejected boolean := false;
  v_state jsonb;
  v_revision bigint;
  v_new_task_id text;
  v_new_queue_count integer;
begin
  if has_function_privilege('anon', 'public.resolve_automation_queue_manual_result_v2(uuid,text,text,text,date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.resolve_automation_queue_manual_result_v2(uuid,text,text,text,date)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.resolve_automation_queue_manual_result_v2(uuid,text,text,text,date)', 'EXECUTE') then
    raise exception 'Manual resolution v2 grants do not follow least privilege';
  end if;

  update public.crm_app_state
  set data = jsonb_build_object(
    'leads', jsonb_build_array(jsonb_build_object('id','ci-lead','name','CI Lead','phone','5515999999999')),
    'tasks', jsonb_build_array(
      jsonb_build_object('id','ci-task-contacted','leadId','ci-lead','date',current_date::text,'type','Ligação','note','Teste','done',false),
      jsonb_build_object('id','ci-task-reschedule','leadId','ci-lead','date',current_date::text,'type','Retorno','note','Teste retorno','done',false)
    )
  ), revision = 1, updated_at = now(), updated_by = 'ci_test'
  where id = 'main';

  insert into public.crm_automation_queue (
    dedupe_key, event_type, source_type, source_id, payload, channel, status
  ) values (
    'manual-resolution-v2-ci-' || gen_random_uuid()::text,
    'lead_follow_up_requested', 'task', 'ci-task-contacted',
    '{"dispatch":{"state":"ready_for_manual_contact","task_id":"ci-task-contacted"}}'::jsonb,
    'internal', 'awaiting_operator'
  ) returning id into v_id;

  v_result := public.resolve_automation_queue_manual_result_v2(
    v_id, 'contacted', 'CI manual outcome', 'ci_test', null
  );

  if coalesce((v_result->>'conflict')::boolean, true) then
    raise exception 'Expected first manual resolution v2 to succeed';
  end if;

  select * into v_row from public.crm_automation_queue where id = v_id;
  if v_row.status <> 'completed'
     or v_row.payload->'dispatch'->>'manual_result' <> 'contacted'
     or v_row.payload->'dispatch'->>'manual_note' <> 'CI manual outcome'
     or v_row.payload->'dispatch'->>'resolved_by' <> 'ci_test'
     or v_row.completed_at is null then
    raise exception 'Manual resolution v2 did not persist expected queue state and audit fields';
  end if;

  select data, revision into v_state, v_revision from public.crm_app_state where id='main';
  if v_revision <> 2 then
    raise exception 'CRM revision was not incremented atomically after manual result';
  end if;
  if coalesce((select (task->>'done')::boolean from jsonb_array_elements(v_state->'tasks') task where task->>'id'='ci-task-contacted'), false) is not true then
    raise exception 'Original CRM task was not marked done';
  end if;

  select count(*) into v_attempt_count
  from public.crm_automation_attempts
  where queue_id = v_id
    and outcome = 'skipped'
    and detail like '%não é confirmação de envio%';
  if v_attempt_count <> 1 then
    raise exception 'Expected exactly one explicit manual audit attempt, got %', v_attempt_count;
  end if;

  insert into public.crm_automation_queue (
    dedupe_key, event_type, source_type, source_id, payload, channel, status
  ) values (
    'manual-reschedule-v2-ci-' || gen_random_uuid()::text,
    'lead_follow_up_requested', 'task', 'ci-task-reschedule',
    '{"dispatch":{"state":"ready_for_manual_contact","task_id":"ci-task-reschedule"}}'::jsonb,
    'internal', 'awaiting_operator'
  ) returning id into v_id_reschedule;

  v_result := public.resolve_automation_queue_manual_result_v2(
    v_id_reschedule, 'rescheduled', 'Retornar amanhã', 'ci_test', current_date + 1
  );

  if coalesce((v_result->>'conflict')::boolean, true) then
    raise exception 'Expected reschedule resolution to succeed';
  end if;
  v_new_task_id := v_result->>'rescheduledTaskId';
  if coalesce(v_new_task_id,'') = '' then
    raise exception 'Reschedule did not return a new task id';
  end if;

  select data, revision into v_state, v_revision from public.crm_app_state where id='main';
  if v_revision <> 3 then
    raise exception 'CRM revision was not incremented after reschedule';
  end if;
  if coalesce((select (task->>'done')::boolean from jsonb_array_elements(v_state->'tasks') task where task->>'id'='ci-task-reschedule'), false) is not true then
    raise exception 'Rescheduled original task was not marked done';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_state->'tasks') task
    where task->>'id'=v_new_task_id
      and task->>'leadId'='ci-lead'
      and task->>'date'=(current_date + 1)::text
      and coalesce((task->>'done')::boolean, true)=false
  ) then
    raise exception 'New rescheduled CRM task was not created correctly';
  end if;

  select count(*) into v_new_queue_count
  from public.crm_automation_queue
  where source_type='task' and source_id=v_new_task_id
    and channel='internal' and status='pending';
  if v_new_queue_count <> 1 then
    raise exception 'Expected exactly one new pending internal queue item for rescheduled task';
  end if;

  if exists (
    select 1 from public.crm_automation_queue
    where source_id=v_new_task_id and channel <> 'internal'
  ) then
    raise exception 'Reschedule unexpectedly created an external-channel queue item';
  end if;

  v_result := public.resolve_automation_queue_manual_result_v2(
    v_id, 'contacted', 'duplicate resolution', 'ci_test', null
  );
  if coalesce((v_result->>'conflict')::boolean, false) is not true then
    raise exception 'Repeated manual resolution must return conflict';
  end if;

  begin
    perform public.resolve_automation_queue_manual_result_v2(
      v_id, 'send_whatsapp', '', 'ci_test', null
    );
  exception when sqlstate '22023' then
    v_invalid_rejected := true;
  end;
  if not v_invalid_rejected then
    raise exception 'Unsupported manual outcome was not rejected';
  end if;

  begin
    perform public.resolve_automation_queue_manual_result_v2(
      v_id_reschedule, 'rescheduled', '', 'ci_test', current_date - 1
    );
  exception when sqlstate '22023' then
    v_bad_date_rejected := true;
  end;
  if not v_bad_date_rejected then
    raise exception 'Past reschedule date was not rejected';
  end if;
end $$;

rollback;