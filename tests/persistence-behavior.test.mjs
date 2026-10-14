import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import handler from '../netlify/functions/crm-state.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const normalizeSource = html.match(/function normalizeState\(s\)\{[\s\S]*?\n\}/)?.[0];
const saveSource = html.match(/async function saveStore\(\)\{[\s\S]*?\n\}\nasync function loadStore\(\)/)?.[0]?.replace(/\nasync function loadStore\(\)$/, '');

function persistenceHarness({ initialRemote = null, requestImpl } = {}) {
  let remote = structuredClone(initialRemote || {
    id: 'state', page: 'dashboard', leads: [], tasks: [], sales: [],
    settings: { studioName: 'Studio Pâmela Pastore', primary: '#1A8690' }
  });
  let revision = 1;
  const context = {
    requestCloud: async (method = 'GET', payload = null) => requestImpl
      ? requestImpl({ method, payload, getRemote: () => structuredClone(remote), getRevision: () => revision,
          setRemote: (value) => { remote = structuredClone(value); }, setRevision: (value) => { revision = value; } })
      : method === 'GET'
        ? { data: structuredClone(remote), revision }
        : (remote = structuredClone(payload.data), revision += 1, { revision }),
    saveLocalCache: async () => {},
    setDbStatus: () => {},
    console: { error: () => {} },
    structuredClone
  };
  vm.runInNewContext(`
    let state = { id: 'state', page: 'dashboard', leads: [], tasks: [], sales: [], settings: { studioName: 'Studio Pâmela Pastore', primary: '#1A8690' } };
    let cloudRevision = 1;
    let cloudAvailable = true;
    let cloudWarning = '';
    let saveQueue = Promise.resolve();
    let confirmedState = JSON.parse(JSON.stringify(state));
    let saveVersion = 0;
    ${normalizeSource}
    ${saveSource}
    globalThis.api = {
      setState(value) { state = JSON.parse(JSON.stringify(value)); },
      getState() { return JSON.parse(JSON.stringify(state)); },
      getConfirmedState() { return JSON.parse(JSON.stringify(confirmedState)); },
      getCloudAvailable() { return cloudAvailable; },
      getCloudWarning() { return cloudWarning; },
      getCloudRevision() { return cloudRevision; },
      saveStore
    };
  `, context);
  return {
    api: context.api,
    getRemote: () => structuredClone(remote),
    getRevision: () => revision
  };
}

const stateWithLead = (name) => ({
  id: 'state', page: 'leads', leads: [{ id: name, name }], tasks: [], sales: [],
  settings: { studioName: 'Studio Pâmela Pastore', primary: '#1A8690' }
});

test('persistência: gravação confirmada retorna sucesso e atualiza o estado remoto', async () => {
  const h = persistenceHarness();
  h.api.setState(stateWithLead('Confirmado'));
  const result = await h.api.saveStore();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'confirmed');
  assert.equal(h.getRemote().leads[0].name, 'Confirmado');
});

test('persistência: resposta perdida após gravação é reconciliada pela leitura remota', async () => {
  let didWrite = false;
  const h = persistenceHarness({
    requestImpl: async ({ method, payload, getRemote, getRevision, setRemote, setRevision }) => {
      if (method === 'GET') return { data: getRemote(), revision: getRevision() };
      if (!didWrite) {
        didWrite = true;
        setRemote(payload.data);
        setRevision(getRevision() + 1);
        throw new Error('Resposta perdida após commit');
      }
      throw new Error('PUT inesperado');
    }
  });
  h.api.setState(stateWithLead('Resposta perdida'));
  const result = await h.api.saveStore();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'confirmed_reconciled');
  assert.equal(h.getRemote().leads[0].name, 'Resposta perdida');
});

test('persistência: falha antes de gravar não é apresentada como sucesso', async () => {
  const h = persistenceHarness({
    requestImpl: async ({ method, getRemote, getRevision }) => {
      if (method === 'GET') return { data: getRemote(), revision: getRevision() };
      throw new Error('Timeout antes do commit');
    }
  });
  h.api.setState(stateWithLead('Não persistido'));
  const result = await h.api.saveStore();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'conflict');
  assert.equal(h.getRemote().leads.length, 0);
  assert.equal(h.api.getState().leads.length, 0);
});

test('persistência: falha na reconciliação resulta em estado desconhecido e bloqueio', async () => {
  const h = persistenceHarness({
    requestImpl: async ({ method }) => { throw new Error(method === 'GET' ? 'GET indisponível' : 'PUT timeout'); }
  });
  h.api.setState(stateWithLead('Estado incerto'));
  const result = await h.api.saveStore();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unknown');
  assert.equal(h.api.getCloudAvailable(), false);
  assert.equal(h.api.getState().leads.length, 0);
});

test('persistência: gravações concorrentes são serializadas e a última alteração não se perde', async () => {
  const h = persistenceHarness();
  h.api.setState(stateWithLead('Primeira'));
  const first = h.api.saveStore();
  h.api.setState(stateWithLead('Segunda'));
  const second = h.api.saveStore();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(h.getRemote().leads[0].name, 'Segunda');
  assert.equal(h.getRevision(), 3);
});

test('autorização: requisição sem sessão não alcança o Supabase', async () => {
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  let dbCalls = 0;
  try {
    process.env.CRM_ALLOWED_ORIGIN = 'https://peppy-salamander-2d8776.netlify.app';
    process.env.CRM_LOGIN_PASSWORD = 'senha-de-teste-com-mais-de-12';
    process.env.CRM_SESSION_SECRET = 's'.repeat(64);
    process.env.SUPABASE_URL = 'https://pposribyzhxyupbxrpfo.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test_only';
    globalThis.fetch = async () => { dbCalls += 1; return Response.json([]); };
    const response = await handler(new Request('https://peppy-salamander-2d8776.netlify.app/.netlify/functions/crm-state', {
      method: 'GET'
    }));
    assert.equal(response.status, 401);
    assert.equal(dbCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ['CRM_ALLOWED_ORIGIN','CRM_LOGIN_PASSWORD','CRM_SESSION_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  }
});

test('autorização: origem não permitida é rejeitada antes de processar o login', async () => {
  const oldEnv = { ...process.env };
  try {
    process.env.CRM_ALLOWED_ORIGIN = 'https://peppy-salamander-2d8776.netlify.app';
    process.env.CRM_LOGIN_PASSWORD = 'senha-de-teste-com-mais-de-12';
    process.env.CRM_SESSION_SECRET = 's'.repeat(64);
    const response = await handler(new Request('https://peppy-salamander-2d8776.netlify.app/.netlify/functions/crm-state?action=login', {
      method: 'POST',
      headers: { origin: 'https://origem-nao-autorizada.example', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'senha-de-teste-com-mais-de-12' })
    }));
    assert.equal(response.status, 403);
  } finally {
    for (const key of ['CRM_ALLOWED_ORIGIN','CRM_LOGIN_PASSWORD','CRM_SESSION_SECRET']) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
  }
});

test('testes de automação não executam envio real de WhatsApp', () => {
  // The test suite only inspects the CRM adapter boundary; it must never call wa.me or a provider API.
  assert.match(html, /function wa\(phone\)/);
  assert.doesNotMatch(html, /fetch\([^)]*(?:whatsapp|messages\/send|graph\.facebook\.com)/i);
});
