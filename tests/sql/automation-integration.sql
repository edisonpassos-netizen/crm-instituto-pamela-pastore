\set ON_ERROR_STOP on
DO $$
DECLARE
  first_id uuid;
  second_id uuid;
  claimed public.crm_automation_queue;
BEGIN
  SELECT public.enqueue_crm_automation(
    'ci-dedupe-001', 'test_event', 'test', 'fixture-1', null,
    '{"fixture":true}'::jsonb, 'internal', now(), 3
  ) INTO first_id;

  SELECT public.enqueue_crm_automation(
    'ci-dedupe-001', 'test_event', 'test', 'fixture-1', null,
    '{"fixture":true}'::jsonb, 'internal', now(), 3
  ) INTO second_id;

  IF first_id <> second_id THEN
    RAISE EXCEPTION 'Deduplication failed: ids differ';
  END IF;

  SELECT * INTO claimed
  FROM public.claim_due_automation_jobs(10)
  WHERE id = first_id;

  IF claimed.id IS NULL THEN
    RAISE EXCEPTION 'Due task was not claimed';
  END IF;
  IF claimed.status <> 'processing' OR claimed.attempts <> 1 THEN
    RAISE EXCEPTION 'Unexpected claimed state: status %, attempts %', claimed.status, claimed.attempts;
  END IF;

  -- Simulate a worker crash: stale processing lock must be reclaimed.
  UPDATE public.crm_automation_queue
  SET status = 'processing', locked_at = now() - interval '11 minutes'
  WHERE id = first_id;

  SELECT * INTO claimed
  FROM public.claim_due_automation_jobs(10)
  WHERE id = first_id;

  IF claimed.id IS NULL THEN
    RAISE EXCEPTION 'Stale processing task was not recovered';
  END IF;
  IF claimed.status <> 'processing' OR claimed.attempts <> 2 THEN
    RAISE EXCEPTION 'Stale lock recovery did not increment attempts: status %, attempts %', claimed.status, claimed.attempts;
  END IF;
  IF claimed.locked_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'Recovered task still has stale lock timestamp';
  END IF;

  IF has_table_privilege('anon', 'public.crm_automation_queue', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not have SELECT on automation queue';
  END IF;
  IF has_function_privilege('anon', 'public.claim_due_automation_jobs(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute claim function';
  END IF;
END $$;

SELECT 'integration assertions passed' AS result;
