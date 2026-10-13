-- End-to-end database assertions for manual follow-up resolution.
-- Runs against an ephemeral PostgreSQL database only.
begin;

do $$
declare
  v_id uuid;
  v_result jsonb;
  v_row public.crm_automation_queue%rowtype;
  v_attempt_count integer;
  v_invalid_rejected boolean := false;
begin
  if has_function_privilege('anon', 'public.resolve_automation_queue_manual_result(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.resolve_automation_queue_manual_result(uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.resolve_automation_queue_manual_result(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'Manual resolution function grants do not follow least privilege';
  end if;

  insert into public.crm_automation_queue (
    dedupe_key, event_type, source_type, source_id, payload, channel, status
  ) values (
    'manual-resolution-ci-' || gen_random_uuid()::text,
    'lead_follow_up_requested', 'task', 'ci-manual-resolution',
    '{"dispatch":{"state":"ready_for_manual_contact"}}'::jsonb,
    'internal', 'awaiting_operator'
  ) returning id into v_id;

  v_result := public.resolve_automation_queue_manual_result(
    v_id, 'contacted', 'CI manual outcome', 'ci_test'
  );

  if coalesce((v_result->>'conflict')::boolean, true) then
    raise exception 'Expected first manual resolution to succeed';
  end if;

  select * into v_row from public.crm_automation_queue where id = v_id;
  if v_row.status <> 'completed'
     or v_row.payload->'dispatch'->>'manual_result' <> 'contacted'
     or v_row.payload->'dispatch'->>'manual_note' <> 'CI manual outcome'
     or v_row.payload->'dispatch'->>'resolved_by' <> 'ci_test'
     or v_row.completed_at is null then
    raise exception 'Manual resolution did not persist expected queue state and audit fields';
  end if;

  select count(*) into v_attempt_count
  from public.crm_automation_attempts
  where queue_id = v_id
    and outcome = 'skipped'
    and detail like '%não é confirmação de envio%';
  if v_attempt_count <> 1 then
    raise exception 'Expected exactly one explicit manual audit attempt, got %', v_attempt_count;
  end if;

  v_result := public.resolve_automation_queue_manual_result(
    v_id, 'contacted', 'duplicate resolution', 'ci_test'
  );
  if coalesce((v_result->>'conflict')::boolean, false) is not true then
    raise exception 'Repeated manual resolution must return conflict';
  end if;

  begin
    perform public.resolve_automation_queue_manual_result(
      v_id, 'send_whatsapp', '', 'ci_test'
    );
  exception when sqlstate '22023' then
    v_invalid_rejected := true;
  end;
  if not v_invalid_rejected then
    raise exception 'Unsupported manual outcome was not rejected';
  end if;
end $$;

rollback;
