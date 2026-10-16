\set ON_ERROR_STOP on

begin;

do $$
declare
  v_queue_id uuid;
  v_result jsonb;
  v_new_task_id text;
  v_state jsonb;
  v_count integer;
  v_invalid_time_rejected boolean := false;
begin
  if has_function_privilege('anon', 'public.resolve_automation_queue_manual_result_v3(uuid,text,text,text,date,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.resolve_automation_queue_manual_result_v3(uuid,text,text,text,date,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.resolve_automation_queue_manual_result_v3(uuid,text,text,text,date,text)', 'EXECUTE') then
    raise exception 'Manual resolution v3 grants do not follow least privilege';
  end if;

  update public.crm_app_state
  set data = jsonb_build_object(
    'leads', jsonb_build_array(jsonb_build_object('id','time-lead','name','Cliente Horário','phone','5515999999999')),
    'tasks', jsonb_build_array(jsonb_build_object(
      'id','time-task-original',
      'leadId','time-lead',
      'date',current_date::text,
      'time','09:00',
      'type','Retorno',
      'note','Solicitação original',
      'done',false
    )),
    'sales','[]'::jsonb,
    'attendances','[]'::jsonb
  ),
      revision = revision + 1,
      updated_at = now(),
      updated_by = 'followup-time-ci'
  where id='main';

  insert into public.crm_automation_queue(
    dedupe_key,event_type,source_type,source_id,payload,channel,status
  ) values (
    'time-resolution-ci-' || gen_random_uuid()::text,
    'lead_follow_up_requested','task','time-task-original',
    '{"dispatch":{"state":"ready_for_manual_contact","task_id":"time-task-original"}}'::jsonb,
    'internal','awaiting_operator'
  ) returning id into v_queue_id;

  v_result := public.resolve_automation_queue_manual_result_v3(
    v_queue_id,
    'rescheduled',
    'Cliente pediu retorno às 14:30',
    'ci_test',
    current_date + 1,
    '14:30'
  );

  if coalesce((v_result->>'conflict')::boolean,true) then
    raise exception 'Expected v3 reschedule to succeed';
  end if;
  if v_result->>'rescheduleTime' <> '14:30' then
    raise exception 'V3 did not return the requested time';
  end if;

  v_new_task_id := v_result->>'rescheduledTaskId';
  select data into v_state from public.crm_app_state where id='main';

  if not exists (
    select 1
    from jsonb_array_elements(v_state->'tasks') task
    where task->>'id'=v_new_task_id
      and task->>'leadId'='time-lead'
      and task->>'date'=(current_date + 1)::text
      and task->>'time'='14:30'
      and coalesce((task->>'done')::boolean,true)=false
  ) then
    raise exception 'Rescheduled task did not persist date/time correctly';
  end if;

  select count(*) into v_count
  from public.crm_automation_queue
  where source_type='task'
    and source_id=v_new_task_id
    and channel='internal';
  if v_count <> 1 then
    raise exception 'Expected exactly one deduplicated internal queue job for v3 reschedule, got %', v_count;
  end if;

  begin
    perform public.resolve_automation_queue_manual_result_v3(
      v_queue_id,
      'rescheduled',
      '',
      'ci_test',
      current_date + 1,
      '25:99'
    );
  exception when sqlstate '22023' then
    v_invalid_time_rejected := true;
  end;
  if not v_invalid_time_rejected then
    raise exception 'Invalid reschedule time was not rejected';
  end if;
end $$;

rollback;
