import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler, { __test } from '../netlify/functions/whatsapp-status-webhook.mjs';

const CRM_TEST_URL = 'https://dxfzuxybubvnjertiowf.supabase.co';
const CRM_TEST_KEY = 'sb_secret_synthetic';

function signed(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}
function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
function expected(overrides={}) {
  return {
    ok: true, statusesReceived: 0, statusRowsUpdated: 0, statusRowsUnmatched: 0,
    messagesReceived: 0, messagesInserted: 0, messagesDuplicate: 0,
    experienceResponsesClassified: 0, experienceResponsesMatched: 0,
    experienceRecoveriesQueued: 0, experienceReviewsQueued: 0,
    ...overrides
  };
}

test('webhook verifies GET challenge and rejects incorrect verification token', async () => {
  const previous = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'fixture-verify-token';
  try {
    const ok = await handler(new Request('https://test.invalid/.netlify/functions/whatsapp-status-webhook?hub.mode=subscribe&hub.verify_token=fixture-verify-token&hub.challenge=challenge-123'));
    assert.equal(ok.status, 200); assert.equal(await ok.text(), 'challenge-123');
    const bad = await handler(new Request('https://test.invalid/?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=x'));
    assert.equal(bad.status, 403);
  } finally { if (previous === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN; else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = previous; }
});

test('webhook rejects missing or invalid Meta signature before accessing database', async () => {
  const previous = { WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET };
  const previousFetch = globalThis.fetch; process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  let fetchCalls = 0; globalThis.fetch = async () => { fetchCalls++; throw new Error('should not access database'); };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', body: '{"entry":[]}' }));
    assert.equal(response.status, 401); assert.equal(fetchCalls, 0);
  } finally { globalThis.fetch = previousFetch; restoreEnv(previous); }
});

test('signed status webhook updates only mocked provider status rows', async () => {
  const previous = { WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret'; process.env.SUPABASE_URL = CRM_TEST_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.TEST_ONLY_1', status: 'delivered', timestamp: '1791633600' },
    { id: 'wamid.TEST_ONLY_2', status: 'failed', timestamp: '1791633601', errors: [{ code: 131026, title: 'fixture failure' }] }
  ] } }] }] });
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body) }); return new Response(JSON.stringify([{ id: 'fixture-attempt' }]), { status: 200 }); };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected({ statusesReceived: 2, statusRowsUpdated: 2 }));
    assert.equal(calls.length, 2); assert.equal(calls[1].body.provider_error_code, '131026');
  } finally { globalThis.fetch = previousFetch; restoreEnv(previous); }
});

test('ordinary inbound text is persisted but does not trigger an experience automation', async () => {
  const previous = { WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret'; process.env.SUPABASE_URL = CRM_TEST_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '1234567890' }, contacts: [{ profile: { name: 'Cliente Teste' }, wa_id: '5515997601234' }],
    messages: [{ from: '5515997601234', id: 'wamid.INBOUND_FIXTURE_1', timestamp: '1791633602', type: 'text', text: { body: 'Quero saber sobre Pilates' } }]
  } }] }] });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), body: options.body ? JSON.parse(options.body) : null }; calls.push(call);
    if (call.url.includes('/rpc/ingest_whatsapp_inbound_message')) return new Response(JSON.stringify({ id: 'msg-1', inserted: true }), { status: 200 });
    return new Response('unexpected request', { status: 500 });
  };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected({ messagesReceived: 1, messagesInserted: 1 }));
    assert.equal(calls.length, 1); assert.equal(calls.some(call => call.url.includes('record_customer_experience_response')), false);
  } finally { globalThis.fetch = previousFetch; restoreEnv(previous); }
});

test('satisfaction quick reply is persisted then routed to the customer experience RPC', async () => {
  const previous = { WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret'; process.env.SUPABASE_URL = CRM_TEST_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '1234567890' }, contacts: [{ profile: { name: 'Maria' }, wa_id: '5515997601234' }],
    messages: [{
      from: '5515997601234', id: 'wamid.SATISFACTION_1', timestamp: '1791633602', type: 'interactive',
      context: { id: 'wamid.REQUEST_1' }, interactive: { type: 'button_reply', button_reply: { id: 'experience_needs_improvement', title: 'Poderia melhorar' } }
    }]
  } }] }] });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), body: options.body ? JSON.parse(options.body) : null }; calls.push(call);
    if (call.url.includes('/rpc/ingest_whatsapp_inbound_message')) return new Response(JSON.stringify({ id: 'msg-2', inserted: true }), { status: 200 });
    if (call.url.includes('/rpc/record_customer_experience_response')) return new Response(JSON.stringify({ matched: true, action: 'recovery_queued' }), { status: 200 });
    return new Response('unexpected request', { status: 500 });
  };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected({ messagesReceived: 1, messagesInserted: 1, experienceResponsesClassified: 1, experienceResponsesMatched: 1, experienceRecoveriesQueued: 1 }));
    const routed = calls.find(call => call.url.includes('/rpc/record_customer_experience_response'));
    assert.equal(routed.body.p_context_provider_message_id, 'wamid.REQUEST_1');
    assert.equal(routed.body.p_satisfaction, 'needs_improvement');
    assert.equal(routed.body.p_response_text, 'Poderia melhorar');
    assert.equal(calls.some(call => call.url.includes('graph.facebook.com')), false);
  } finally { globalThis.fetch = previousFetch; restoreEnv(previous); }
});

test('positive satisfaction reply can queue neutral review invitation without sending in webhook', async () => {
  const previous = { WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret'; process.env.SUPABASE_URL = CRM_TEST_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '5515997601234', id: 'wamid.SATISFACTION_2', timestamp: '1791633602', type: 'button', context: { id: 'wamid.REQUEST_2' }, button: { payload: 'experience_very_good', text: 'Muito boa' } }] } }] }] });
  globalThis.fetch = async (url) => {
    if (String(url).includes('/rpc/ingest_whatsapp_inbound_message')) return new Response(JSON.stringify({ id: 'msg-3', inserted: true }), { status: 200 });
    if (String(url).includes('/rpc/record_customer_experience_response')) return new Response(JSON.stringify({ matched: true, action: 'review_queued' }), { status: 200 });
    return new Response('unexpected', { status: 500 });
  };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected({ messagesReceived: 1, messagesInserted: 1, experienceResponsesClassified: 1, experienceResponsesMatched: 1, experienceReviewsQueued: 1 }));
  } finally { globalThis.fetch = previousFetch; restoreEnv(previous); }
});

test('duplicate inbound message is acknowledged without rerunning experience classification', async () => {
  const previous = { WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret'; process.env.SUPABASE_URL = CRM_TEST_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '5515997601234', id: 'wamid.INBOUND_DUPLICATE', timestamp: '1791633603', type: 'text', text: { body: 'Muito boa' } }] } }] }] });
  let calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ id: 'msg-4', inserted: false }), { status: 200 }); };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.messagesDuplicate, 1); assert.equal(result.experienceResponsesClassified, 0); assert.equal(calls, 1);
  } finally { globalThis.fetch = previousFetch; restoreEnv(previous); }
});

test('signature verifier rejects tampering and inbound parser preserves reply context', () => {
  assert.equal(__test.verifySignature('{"a":1}', signed('{"a":1}', 'secret'), 'secret'), true);
  assert.equal(__test.verifySignature('{"a":2}', signed('{"a":1}', 'secret'), 'secret'), false);
  assert.deepEqual(__test.inboundResponseFields({ interactive: { button_reply: { id: 'experience_good', title: 'Boa' } } }, 'interactive'), { textBody: 'Boa', responseKey: 'experience_good' });
});
