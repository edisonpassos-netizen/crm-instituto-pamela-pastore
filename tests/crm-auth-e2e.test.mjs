import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/crm-state.mjs';

const origin = 'https://peppy-salamander-2d8776.netlify.app';
const keys = ['CRM_ALLOWED_ORIGIN', 'CRM_LOGIN_PASSWORD', 'CRM_SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function withTestEnvironment(run) {
  const oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  for (const key of keys) {
    if (oldEnv[key] === undefined) delete process.env[key];
  }
  process.env.CRM_ALLOWED_ORIGIN = origin;
  process.env.CRM_LOGIN_PASSWORD = 'crm-test-password-long';
  process.env.CRM_SESSION_SECRET = 'test-session-secret-'.padEnd(64, 'x');
  process.env.SUPABASE_URL = 'https://pposribyzhxyupbxrpfo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_only';
  return Promise.resolve().then(run).finally(() => {
    globalThis.fetch = oldFetch;
    for (const key of keys) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  });
}

const req = (path, { method = 'GET', cookie, body, requestOrigin = origin } = {}) =>
  new Request(origin + '/.netlify/functions/crm-state' + path, {
    method,
    headers: {
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

test('autenticação ponta a ponta: login, sessão assinada e leitura protegida usam banco simulado', async () => {
  await withTestEnvironment(async () => {
    let databaseCalls = 0;
    globalThis.fetch = async (url, options = {}) => {
      databaseCalls += 1;
      assert.match(String(url), /\/rest\/v1\/crm_app_state/);
      assert.equal(options.headers.Authorization, 'Bearer sb_secret_test_only');
      return Response.json([{
        id: 'main',
        data: { id: 'state', leads: [], tasks: [], sales: [], settings: {} },
        revision: 1,
        updated_at: '2026-10-14T12:00:00.000Z'
      }]);
    };

    const login = await handler(req('?action=login', { method: 'POST', body: { password: process.env.CRM_LOGIN_PASSWORD } }));
    assert.equal(login.status, 200);
    const cookieHeader = login.headers.get('set-cookie');
    assert.match(cookieHeader || '', /HttpOnly/);
    assert.match(cookieHeader || '', /Secure/);
    assert.match(cookieHeader || '', /SameSite=Strict/);
    const cookie = cookieHeader.split(';')[0];

    const session = await handler(req('?action=session', { cookie }));
    assert.equal(session.status, 200);
    assert.equal((await session.json()).authenticated, true);

    const data = await handler(req('', { cookie }));
    assert.equal(data.status, 200);
    assert.equal((await data.json()).revision, 1);
    assert.equal(databaseCalls, 1);
  });
});

test('autorização ponta a ponta: cookie forjado não alcança o banco', async () => {
  await withTestEnvironment(async () => {
    let databaseCalls = 0;
    globalThis.fetch = async () => { databaseCalls += 1; return Response.json([]); };
    const response = await handler(req('', { cookie: 'crm_session=forged.token' }));
    assert.equal(response.status, 401);
    assert.equal(databaseCalls, 0);
  });
});

test('autorização: cookie com percent-encoding inválido é rejeitado sem erro 500', async () => {
  await withTestEnvironment(async () => {
    let databaseCalls = 0;
    globalThis.fetch = async () => { databaseCalls += 1; return Response.json([]); };
    const response = await handler(req('', { cookie: 'crm_session=%E0%A4%A' }));
    assert.equal(response.status, 401);
    assert.equal(databaseCalls, 0);
  });
});

test('autorização ponta a ponta: origem divergente é bloqueada', async () => {
  await withTestEnvironment(async () => {
    let databaseCalls = 0;
    globalThis.fetch = async () => { databaseCalls += 1; return Response.json([]); };
    const response = await handler(req('?action=login', {
      method: 'POST',
      requestOrigin: 'https://untrusted.example',
      body: { password: process.env.CRM_LOGIN_PASSWORD }
    }));
    assert.equal(response.status, 403);
    assert.equal(databaseCalls, 0);
  });
});
