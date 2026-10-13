import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import handler from '../netlify/functions/crm-state.mjs';

const ORIGIN = 'https://peppy-salamander-2d8776.netlify.app';
const SECRET = 'test-session-secret-for-operator-queue-123456789';
const QUEUE_ID = '00000000-0000-4000-8000-000000000001';

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: randomBytes(16).toString('base64url')
  })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `crm_session=${payload}.${signature}`;
}

function request(url, method = 'GET', body = null) {
  return new Request(url, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: sessionCookie(),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

function restore(previous) {
  globalThis.fetch = previous.fetch;
  for (const [key, value] of Object.entries(previous.env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('operator queue endpoint requires a valid session and returns only awaiting_operator jobs', async () => {
  const previous = { fetch: globalThis.fetch, env: {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRM_SESSION_SECRET: process.env.CRM_SESSION_SECRET
  }};
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret-test-key';
  process.env.CRM_SESSION_SECRET = SECRET;
  let requested = '';
  globalThis.fetch = async url => {
    requested = String(url);
    return new Response(JSON.stringify([{ id: QUEUE_ID, status: 'awaiting_operator' }]), { status: 200 });
  };
  try {
    const response = await handler(request(ORIGIN + '/.netlify/functions/crm-state?action=automation-queue'));
    assert.equal(response.status, 200);
    assert.match(requested, /status=eq\.awaiting_operator/);
    assert.deepEqual(await response.json(), { items: [{ id: QUEUE_ID, status: 'awaiting_operator' }] });
    const denied = await handler(new Request(ORIGIN + '/.netlify/functions/crm-state?action=automation-queue', { headers: { Origin: ORIGIN } }));
    assert.equal(denied.status, 401);
  } finally { restore(previous); }
});

test('explicit CRM origin allowlist does not implicitly trust production origin', async () => {
  const previous = { fetch: globalThis.fetch, env: {
    CRM_ALLOWED_ORIGIN: process.env.CRM_ALLOWED_ORIGIN,
    CRM_SESSION_SECRET: process.env.CRM_SESSION_SECRET
  }};
  const testOrigin = 'https://crm-automacao-teste.netlify.app';
  process.env.CRM_ALLOWED_ORIGIN = testOrigin;
  process.env.CRM_SESSION_SECRET = SECRET;
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: QUEUE_ID, status: 'awaiting_operator' }]), { status: 200 });
  try {
    const accepted = await handler(request(testOrigin + '/.netlify/functions/crm-state?action=automation-queue'));
    assert.equal(accepted.status, 200);
    const denied = await handler(request(ORIGIN + '/.netlify/functions/crm-state?action=automation-queue'));
    assert.equal(denied.status, 403);
  } finally { restore(previous); }
});

test('manual result only resolves an awaiting job and records a clearly manual audit event', async () => {
  const previous = { fetch: globalThis.fetch, env: {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRM_SESSION_SECRET: process.env.CRM_SESSION_SECRET
  }};
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-secret-test-key';
  process.env.CRM_SESSION_SECRET = SECRET;
  const job = { id: QUEUE_ID, status: 'awaiting_operator', attempts: 1, payload: { dispatch: { state: 'ready_for_manual_contact' } } };
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const record = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
    requests.push(record);
    if (record.url.includes('/rpc/resolve_automation_queue_manual_result') && record.method === 'POST') {
      return new Response(JSON.stringify({ conflict: false, item: { id: QUEUE_ID, status: 'completed' } }), { status: 200 });
    }
    return new Response('unexpected request', { status: 500 });
  };
  try {
    const response = await handler(request(ORIGIN + '/.netlify/functions/crm-state?action=automation-queue-result', 'POST', {
      id: QUEUE_ID, outcome: 'contacted', note: 'Contato telefônico realizado.'
    }));
    assert.equal(response.status, 200);
    assert.match((await response.json()).message, /Nenhuma mensagem foi enviada/);
    const rpc = requests.find(r => r.url.includes('/rpc/resolve_automation_queue_manual_result'));
    assert.equal(rpc.method, 'POST');
    assert.equal(rpc.body.p_queue_id, QUEUE_ID);
    assert.equal(rpc.body.p_outcome, 'contacted');
    assert.equal(rpc.body.p_note, 'Contato telefônico realizado.');
    assert.equal(requests.some(r => r.method === 'PATCH'), false);
    assert.equal(requests.some(r => r.url.includes('/crm_automation_attempts')), false);
    assert.equal(requests.some(r => r.url.includes('graph.facebook.com')), false);
  } finally { restore(previous); }
});

test('manual result rejects unsupported outcomes and malformed IDs before touching Supabase', async () => {
  const previous = { fetch: globalThis.fetch, env: {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRM_SESSION_SECRET: process.env.CRM_SESSION_SECRET
  }};
  process.env.CRM_SESSION_SECRET = SECRET;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('unexpected', { status: 500 }); };
  try {
    const response = await handler(request(ORIGIN + '/.netlify/functions/crm-state?action=automation-queue-result', 'POST', {
      id: 'not-a-uuid', outcome: 'send_whatsapp'
    }));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  } finally { restore(previous); }
});
