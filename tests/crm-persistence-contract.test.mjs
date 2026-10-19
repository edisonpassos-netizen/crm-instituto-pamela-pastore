import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/crm-state.mjs';

const origin = 'https://peppy-salamander-2d8776.netlify.app';
const endpoint = `${origin}/.netlify/functions/crm-state`;
function setup(t) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    CRM_LOGIN_PASSWORD: 'synthetic-password-only',
    CRM_SESSION_SECRET: 'synthetic-session-secret-at-least-32-characters',
    SUPABASE_URL: 'https://dxfzuxybubvnjertiowf.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic', AUTOMATIONS_ENABLED: 'false'
  });
  const realFetch = globalThis.fetch;
  let row = { id: 'main', data: { leads: [], tasks: [], settings: { synthetic: true } }, revision: 1 };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, process.env.SUPABASE_URL);
    assert.equal(url.pathname, '/rest/v1/crm_app_state');
    if (options.method === 'PATCH') {
      if (url.searchParams.get('revision') !== `eq.${row.revision}`) return Response.json([]);
      row = { ...row, ...JSON.parse(options.body) };
      return Response.json([{ revision: row.revision, updated_at: row.updated_at }]);
    }
    return Response.json([structuredClone(row)]);
  };
  t.after(() => { globalThis.fetch = realFetch; process.env = previous; });
  return {
    request: (method = 'GET', body, cookie = '', suffix = '') => handler(new Request(endpoint + suffix, {
      method, headers: { origin, cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })),
    row: () => structuredClone(row)
  };
}
async function login(api) {
  const response = await api.request('POST', { password: 'synthetic-password-only' }, '', '?action=login');
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  return cookie.split(';')[0];
}

test('lead create/edit persists across repeated reads and a fresh login (mock REST)', async t => {
  const api = setup(t); const cookie = await login(api);
  let data = { ...api.row().data, leads: [{ id: 'synthetic-1', name: 'QA Synthetic', phone: '00000000000' }] };
  assert.equal((await api.request('PUT', { data, revision: 1 }, cookie)).status, 200);
  const read = await (await api.request('GET', undefined, cookie)).json();
  assert.equal(read.data.leads[0].name, 'QA Synthetic');
  data = { ...read.data, leads: [{ ...read.data.leads[0], name: 'QA Edited' }] };
  assert.equal((await api.request('PUT', { data, revision: 2 }, cookie)).status, 200);
  const fresh = await login(api);
  const result = await (await api.request('GET', undefined, fresh)).json();
  assert.equal(result.data.leads[0].name, 'QA Edited');
  assert.deepEqual(result.data.settings, { synthetic: true });
});

test('competing stale writes and duplicate retries receive 409 (mock REST)', async t => {
  const api = setup(t); const cookie = await login(api);
  const data = { ...api.row().data, leads: [{ id: 'synthetic-1' }] };
  const results = await Promise.all([api.request('PUT', { data, revision: 1 }, cookie), api.request('PUT', { data, revision: 1 }, cookie)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  assert.equal((await api.request('PUT', { data, revision: 1 }, cookie)).status, 409);
  assert.equal(api.row().revision, 2);
});

test('follow-up create, reschedule and completion preserve unrelated data (mock REST)', async t => {
  const api = setup(t); const cookie = await login(api);
  let data = { ...api.row().data, leads: [{ id: 'synthetic-1' }], tasks: [{ id: 'synthetic-task', leadId: 'synthetic-1', date: '2026-10-21', done: false }] };
  for (let revision = 1; revision <= 3; revision++) {
    if (revision === 2) data.tasks[0].date = '2026-10-22';
    if (revision === 3) data.tasks[0].done = true;
    assert.equal((await api.request('PUT', { data, revision }, cookie)).status, 200);
    data = (await (await api.request('GET', undefined, cookie)).json()).data;
  }
  assert.equal(data.tasks[0].done, true);
  assert.equal(data.tasks[0].date, '2026-10-22');
  assert.equal(data.leads[0].id, 'synthetic-1');
});

test('invalid payloads and full erase are rejected (mock REST)', async t => {
  const api = setup(t); const cookie = await login(api);
  for (const payload of [{ data: [], revision: 1 }, { data: {}, revision: 0 }, { data: {}, revision: 1, automationEvents: {} }]) {
    assert.equal((await api.request('PUT', payload, cookie)).status, 400);
  }
  assert.equal((await api.request('PUT', { data: { leads: [{ id: 'synthetic-1' }] }, revision: 1 }, cookie)).status, 200);
  assert.equal((await api.request('PUT', { data: { leads: [] }, revision: 2 }, cookie)).status, 409);
});

test('unauthenticated and foreign-origin requests cannot access state', async t => {
  const api = setup(t);
  assert.equal((await api.request()).status, 401);
  assert.equal((await handler(new Request(endpoint, { headers: { origin: 'https://invalid.example' } }))).status, 403);
});

test('database communication failure returns an error and allows a later read (mock REST)', async t => {
  const api = setup(t); const cookie = await login(api);
  const mockFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Synthetic connection interruption'); };
  assert.equal((await api.request('GET', undefined, cookie)).status, 500);
  globalThis.fetch = mockFetch;
  assert.equal((await api.request('GET', undefined, cookie)).status, 200);
  assert.equal(api.row().revision, 1);
});
