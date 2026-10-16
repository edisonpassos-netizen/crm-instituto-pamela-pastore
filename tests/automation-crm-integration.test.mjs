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
  } finally { restore(previous); }
});

test('satisfaction request is built only from persisted attendance consent and customer data', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  const requests = [];
  const persisted = {
    attendances: [{
      id: 'attendance-42', leadId: 'lead-7', status: 'Concluído',
      experienceConsent: true, experienceConsentAt: '2026-10-12T12:00:00.000Z',
      serviceName: 'Pilates experimental'
    }],
    leads: [{ id: 'lead-7', name: 'Maria Silva', phone: '+55 (15) 99999-9999' }]
  };
  const experienceId = '11111111-1111-4111-8111-111111111111';
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    requests.push(call);
    if (call.url.includes('/crm_app_state?')) return new Response(JSON.stringify([{ data: persisted }]), { status: 200 });
    if (call.url.includes('/rpc/register_customer_experience_request')) return new Response(JSON.stringify(experienceId), { status: 200 });
    if (call.url.includes('/rpc/enqueue_crm_automation')) return new Response(JSON.stringify('fixture-queue-id'), { status: 200 });
    return new Response('unexpected request', { status: 500 });
  };
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'experience:attendance-42', type: 'service_completed',
      sourceType: 'attendance', sourceId: 'attendance-42',
      occurredAt: '2026-10-12T12:00:00.000Z',
      recipient_phone: 'attacker-controlled', customer_opt_in: false,
      google_review_url: 'https://attacker.example'
    }]);
    assert.deepEqual(result, { acceptedEventIds: ['experience:attendance-42'], failures: [] });
    assert.equal(requests.length, 3);
    const registration = requests.find(call => call.url.includes('/rpc/register_customer_experience_request')).body;
    assert.equal(registration.p_recipient_phone, '5515999999999');
    assert.equal(registration.p_first_name, 'Maria');
    assert.equal(registration.p_service_name, 'Pilates experimental');
    assert.equal(registration.p_metadata.consent_source, 'experienceConsent');
    const queued = requests.find(call => call.url.includes('/rpc/enqueue_crm_automation')).body;
    assert.equal(queued.p_channel, 'whatsapp');
    assert.equal(queued.p_event_type, 'satisfaction_request');
    assert.equal(queued.p_source_type, 'customer_experience');
    assert.equal(queued.p_source_id, experienceId);
    assert.equal(queued.p_recipient_phone, '5515999999999');
    assert.equal(queued.p_payload.customer_opt_in, true);
    assert.equal(queued.p_payload.first_name, 'Maria');
    assert.equal(queued.p_payload.service_name, 'Pilates experimental');
    assert.deepEqual(queued.p_payload.template_parameters, ['Maria', 'Pilates experimental']);
    assert.equal(queued.p_dedupe_key, `crm:satisfaction_request:experience:${experienceId}`);
  } finally { restore(previous); }
});

test('legacy review consent remains a backward-compatible contact consent during migration', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  const persisted = {
    attendances: [{ id: 'attendance-42', leadId: 'lead-7', status: 'Concluído', reviewConsent: true, consentAt: '2026-10-12T12:00:00.000Z' }],
    leads: [{ id: 'lead-7', name: 'Maria Silva', phone: '5515999999999' }]
  };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('/crm_app_state?')) return new Response(JSON.stringify([{ data: persisted }]), { status: 200 });
    if (String(url).includes('/rpc/register_customer_experience_request')) return new Response(JSON.stringify('11111111-1111-4111-8111-111111111111'), { status: 200 });
    if (String(url).includes('/rpc/enqueue_crm_automation')) return new Response(JSON.stringify('fixture-queue-id'), { status: 200 });
    return new Response('unexpected', { status: 500 });
  };
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'legacy-consent', type: 'service_completed', sourceType: 'attendance',
      sourceId: 'attendance-42', occurredAt: '2026-10-12T12:00:00.000Z'
    }]);
    assert.deepEqual(result.failures, []);
    assert.equal(calls.some(url => url.includes('/rpc/enqueue_crm_automation')), true);
  } finally { restore(previous); }
});

test('satisfaction request is rejected before registration or queue when persisted consent is absent', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  let writeCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/crm_app_state?')) return new Response(JSON.stringify([{
      data: { attendances: [{ id: 'attendance-42', leadId: 'lead-7', status: 'Concluído', experienceConsent: false }], leads: [{ id: 'lead-7', name: 'Maria Silva', phone: '5515999999999' }] }
    }]), { status: 200 });
    writeCalls++;
    return new Response('unexpected request', { status: 500 });
  };
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'experience:attendance-42', type: 'service_completed',
      sourceType: 'attendance', sourceId: 'attendance-42', occurredAt: '2026-10-12T12:00:00.000Z'
    }]);
    assert.deepEqual(result.acceptedEventIds, []);
    assert.equal(result.failures.length, 1);
    assert.equal(writeCalls, 0);
  } finally { restore(previous); }
});

test('unsupported appointment events are rejected before any queue network call', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('unexpected', { status: 200 }); };
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'event-not-supported', type: 'appointment_completed',
      sourceType: 'appointment', sourceId: 'appointment-5', occurredAt: '2026-10-10T12:00:00.000Z'
    }]);
    assert.deepEqual(result.acceptedEventIds, []);
    assert.equal(result.failures.length, 1);
    assert.equal(calls, 0);
  } finally { restore(previous); }
});

test('queue service failures are returned for client retry', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, fetch: globalThis.fetch };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  globalThis.fetch = async () => new Response('db failure', { status: 503 });
  try {
    const result = await enqueueAutomationEvents([{
      clientEventId: 'event-fail', type: 'lead_follow_up_requested', sourceType: 'task',
      sourceId: 'task-fixture-fail', occurredAt: '2026-10-10T12:00:00.000Z'
    }]);
    assert.deepEqual(result.acceptedEventIds, []);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /HTTP 503/);
  } finally { restore(previous); }
});
