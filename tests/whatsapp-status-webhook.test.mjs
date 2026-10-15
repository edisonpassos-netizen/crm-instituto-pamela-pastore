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
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('webhook verifies GET challenge and rejects incorrect verification token', async () => {
  const previous = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'fixture-verify-token';
  try {
    const ok = await handler(new Request('https://test.invalid/.netlify/functions/whatsapp-status-webhook?hub.mode=subscribe&hub.verify_token=fixture-verify-token&hub.challenge=challenge-123'));
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'challenge-123');
    const bad = await handler(new Request('https://test.invalid/?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=x'));
    assert.equal(bad.status, 403);
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN; else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = previous;
  }
});

test('webhook rejects missing or invalid Meta signature before accessing database', async () => {
  const previous = { WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('should not access database'); };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', body: '{"entry":[]}' }));
    assert.equal(response.status, 401);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test('signed status webhook updates only mocked provider status rows', async () => {
  const previous = {
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.TEST_ONLY_1', status: 'delivered', timestamp: '1791633600', recipient_id: '5515000000000' },
    { id: 'wamid.TEST_ONLY_2', status: 'failed', timestamp: '1791633601', errors: [{ code: 131026, title: 'fixture failure' }] }
  ] } }] }] });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify([{ id: 'fixture-attempt' }]), { status: 200 });
  };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      statusesReceived: 2,
      statusRowsUpdated: 2,
      statusRowsUnmatched: 0,
      messagesReceived: 0,
      messagesInserted: 0,
      messagesDuplicate: 0
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.provider_status, 'delivered');
    assert.equal(calls[1].body.provider_status, 'failed');
    assert.equal(calls[1].body.provider_error_code, '131026');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test('signed inbound text message is persisted through idempotent RPC without outbound call', async () => {
  const previous = {
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({
    entry: [{ changes: [{ value: {
      metadata: { display_phone_number: '15550000000', phone_number_id: '1234567890' },
      contacts: [{ profile: { name: 'Cliente Teste' }, wa_id: '5515997601234' }],
      messages: [{ from: '5515997601234', id: 'wamid.INBOUND_FIXTURE_1', timestamp: '1791633602', type: 'text', text: { body: 'Quero saber sobre Pilates' } }]
    } }] }]
  });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    if (call.url.includes('/rpc/ingest_whatsapp_inbound_message')) {
      return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000099', inserted: true }), { status: 200 });
    }
    return new Response('unexpected request', { status: 500 });
  };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      statusesReceived: 0,
      statusRowsUpdated: 0,
      statusRowsUnmatched: 0,
      messagesReceived: 1,
      messagesInserted: 1,
      messagesDuplicate: 0
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /rpc\/ingest_whatsapp_inbound_message/);
    assert.equal(calls[0].body.p_provider_message_id, 'wamid.INBOUND_FIXTURE_1');
    assert.equal(calls[0].body.p_phone_number_id, '1234567890');
    assert.equal(calls[0].body.p_contact_wa_id, '5515997601234');
    assert.equal(calls[0].body.p_contact_name, 'Cliente Teste');
    assert.equal(calls[0].body.p_message_type, 'text');
    assert.equal(calls[0].body.p_text_body, 'Quero saber sobre Pilates');
    assert.equal(calls.some(call => call.url.includes('graph.facebook.com')), false);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test('duplicate inbound message is acknowledged without creating a second record', async () => {
  const previous = {
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  process.env.SUPABASE_URL = CRM_TEST_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CRM_TEST_KEY;
  const body = JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: '1234567890' },
    messages: [{ from: '5515997601234', id: 'wamid.INBOUND_DUPLICATE', timestamp: '1791633603', type: 'text', text: { body: 'Olá' } }]
  } }] }] });
  globalThis.fetch = async () => new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000100', inserted: false }), { status: 200 });
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.messagesReceived, 1);
    assert.equal(result.messagesInserted, 0);
    assert.equal(result.messagesDuplicate, 1);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv(previous);
  }
});

test('signature verifier rejects tampering', () => {
  assert.equal(__test.verifySignature('{"a":1}', signed('{"a":1}', 'secret'), 'secret'), true);
  assert.equal(__test.verifySignature('{"a":2}', signed('{"a":1}', 'secret'), 'secret'), false);
});
