import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAutomationEvents } from '../netlify/functions/lib/automation-enqueue.mjs';

test('explicit CRM event is converted and enqueued via RPC only after caller elects to submit it', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify('fixture-queue-id'), { status: 200 });
  };
  try {
    const events = [{
      clientEventId: 'task-fixture-1',
      type: 'lead_follow_up_requested',
      sourceType: 'task',
      sourceId: 'task-fixture-1',
      occurredAt: '2026-10-10T12:00:00.000Z'
    }];
    const result = await enqueueAutomationEvents(events);
    assert.deepEqual(result, { acceptedEventIds: ['task-fixture-1'], failures: [] });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/rpc\/enqueue_crm_automation$/);
    assert.equal(requests[0].body.p_dedupe_key, 'crm:lead_follow_up_requested:task:task-fixture-1');
    assert.equal(requests[0].body.p_channel, 'internal');
    assert.equal(requests[0].body.p_recipient_phone, null);
    assert.equal(requests[0].body.p_max_attempts, 3);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('failed queue events are returned for client retry and external channel is impossible', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  globalThis.fetch = async () => new Response('db failure', { status: 503 });
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'event-fail',
      type: 'service_completed',
      sourceType: 'service',
      sourceId: 'svc-1',
      occurredAt: '2026-10-10T12:00:00.000Z',
      channel: 'whatsapp',
      recipient_phone: '5515999999999'
    }]);
    assert.deepEqual(result.acceptedEventIds, []);
    assert.equal(result.failures.length, 1);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});
