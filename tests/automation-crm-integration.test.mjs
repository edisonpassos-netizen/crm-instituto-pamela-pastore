import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAutomationEvents } from '../netlify/functions/lib/automation-enqueue.mjs';

function restore(previous) {
  globalThis.fetch = previous.fetch;
  if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
  if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
}

test('explicit supported CRM follow-up is enqueued through the server RPC', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify('fixture-queue-id'), { status: 200 });
  };
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'task-fixture-1',
      type: 'lead_follow_up_requested',
      sourceType: 'task',
      sourceId: 'task-fixture-1',
      occurredAt: '2026-10-10T12:00:00.000Z'
    }]);
    assert.deepEqual(result, { acceptedEventIds: ['task-fixture-1'], failures: [] });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/rpc\/enqueue_crm_automation$/);
    assert.equal(requests[0].body.p_dedupe_key, 'crm:lead_follow_up_requested:task:task-fixture-1');
    assert.equal(requests[0].body.p_channel, 'internal');
    assert.equal(requests[0].body.p_recipient_phone, null);
    assert.equal(requests[0].body.p_max_attempts, 3);
  } finally {
    restore(previous);
  }
});

test('unsupported appointment/service events are rejected before any queue network call', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('unexpected', { status: 200 }); };
  try {
    for (const type of ['appointment_completed', 'service_completed']) {
      const result = await enqueueAutomationEvents([{
        clientEventId: 'event-not-supported',
        type,
        sourceType: 'service',
        sourceId: 'fixture-service-5',
        occurredAt: '2026-10-10T12:00:00.000Z',
        channel: 'whatsapp',
        recipient_phone: '5515999999999'
      }]);
      assert.deepEqual(result.acceptedEventIds, []);
      assert.equal(result.failures.length, 1);
    }
    assert.equal(calls, 0, 'unsupported events must never reach the queue RPC');
  } finally {
    restore(previous);
  }
});

test('queue service failures are returned for client retry', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  globalThis.fetch = async () => new Response('db failure', { status: 503 });
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'event-fail',
      type: 'lead_follow_up_requested',
      sourceType: 'task',
      sourceId: 'task-fixture-fail',
      occurredAt: '2026-10-10T12:00:00.000Z'
    }]);
    assert.deepEqual(result.acceptedEventIds, []);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /HTTP 503/);
  } finally {
    restore(previous);
  }
});
