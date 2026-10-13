import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { enqueueAutomationEvents } from './lib/automation-enqueue.mjs';

const DEFAULT_ORIGIN = 'https://peppy-salamander-2d8776.netlify.app';
const SESSION_COOKIE = 'crm_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const TABLE_URL = () => {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/rest/v1/crm_app_state`;
};

const json = (statusCode, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
});


function normalizedOrigin(value) {
  return (value || '').trim().replace(/\/$/, '');
}

function configuredOrigins() {
  const configured = (process.env.CRM_ALLOWED_ORIGIN || '')
    .split(',')
    .map(normalizedOrigin)
    .filter(Boolean);
  // Use the production origin only as a fallback when no explicit allowlist exists.
  // A configured test/preview origin must not implicitly trust the production CRM origin.
  return new Set(configured.length ? configured : [DEFAULT_ORIGIN]);
}

function isAllowedOrigin(origin) {
  return configuredOrigins().has(origin);
}

function allowedOrigin(request) {
  const origin = normalizedOrigin(request.headers.get('origin'));
  let requestOrigin = '';
  try { requestOrigin = normalizedOrigin(new URL(request.url).origin); } catch {}
  // Permit the official site origin and any additional origins explicitly configured by the site owner.
  // CRM_ALLOWED_ORIGIN may contain a comma-separated allowlist when needed.
  if (origin) return isAllowedOrigin(origin);
  // Same-origin GETs may omit Origin. Never allow an origin-less write.
  return isAllowedOrigin(requestOrigin) && ['GET', 'HEAD'].includes(request.method);
}

function corsHeaders(request) {
  const origin = normalizedOrigin(request.headers.get('origin'));
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Access-Control-Allow-Credentials': 'true'
  };
  if (origin && isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function sessionSecret() {
  const secret = process.env.CRM_SESSION_SECRET || '';
  if (secret.length < 32) throw new Error('CRM_SESSION_SECRET deve ter pelo menos 32 caracteres.');
  return secret;
}

function sign(value) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(16).toString('base64url')
  })).toString('base64url');
  return payload + '.' + sign(payload);
}

function validSession(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookie = cookieHeader.split(';').map(v => v.trim()).find(v => v.startsWith(SESSION_COOKIE + '='));
  if (!cookie) return false;
  let token;
  try { token = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)); } catch { return false; }
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    if (!safeEqual(sign(parts[0]), parts[1])) return false;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function supabaseRequest(method, query = '', body = null) {
  const url = TABLE_URL() + query;
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!supabaseUrl || !key) {
    console.error('CRM Supabase configuration check:', {
      hasUrl: Boolean(supabaseUrl),
      hasKey: Boolean(key),
      keyLooksPublic: key.startsWith('sb_publishable_'),
      keyLooksSecret: key.startsWith('sb_secret_')
    });
    const err = new Error('Configuração do Supabase incompleta no servidor. Confira SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Netlify.');
    err.status = 500;
    throw err;
  }
  if (key.startsWith('sb_publishable_')) {
    console.error('CRM Supabase configuration check: SUPABASE_SERVICE_ROLE_KEY contains a publishable key, not a server secret.');
    const err = new Error('A chave recebida pela função do CRM é pública. No Netlify, configure a chave secreta de servidor em SUPABASE_SERVICE_ROLE_KEY com escopo Functions e contexto correto; depois publique novamente.');
    err.status = 500;
    throw err;
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const options = { method, headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const responseText = await response.text();
  let parsed = null;
  try { parsed = responseText ? JSON.parse(responseText) : null; } catch {}
  if (!response.ok) {
    console.error('CRM Supabase request failed:', {
      status: response.status,
      code: parsed?.code || null,
      message: parsed?.message || null,
      keyLooksSecret: key.startsWith('sb_secret_'),
      keyLooksLegacyServiceRole: key.startsWith('eyJ'),
      urlMatchesExpectedProject: supabaseUrl === 'https://pposribyzhxyupbxrpfo.supabase.co'
    });
    const detail = response.status === 401
      ? 'Supabase recusou a chave configurada no servidor (HTTP 401). Confira se a chave secreta pertence ao mesmo projeto indicado em SUPABASE_URL.'
      : `Supabase respondeu HTTP ${response.status}.`;
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }
  return parsed;
}


async function supabaseQueueRequest(method, query = '', body = null) {
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key || key.startsWith('sb_publishable_')) {
    const err = new Error('Configuração secreta do Supabase ausente ou inválida.');
    err.status = 500;
    throw err;
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const options = { method, headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${base}/rest/v1/crm_automation_queue${query}`, options);
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const err = new Error(`Supabase respondeu HTTP ${response.status} ao acessar a fila de automação.`);
    err.status = response.status;
    throw err;
  }
  return parsed;
}



export default async (request) => {
  const cors = corsHeaders(request);
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  if (request.method === 'OPTIONS') {
    if (!allowedOrigin(request)) return json(403, { error: 'Origem não autorizada. Configure CRM_ALLOWED_ORIGIN.' });
    return new Response(null, { status: 204, headers: cors });
  }

  if (!allowedOrigin(request)) return json(403, { error: 'Origem não autorizada. Confira a URL configurada em CRM_ALLOWED_ORIGIN.' }, cors);

  if (action === 'login' && request.method === 'POST') {
    const configuredPassword = process.env.CRM_LOGIN_PASSWORD || '';
    if (!configuredPassword || configuredPassword.length < 12) {
      return json(503, { error: 'Acesso ainda não configurado. Defina CRM_LOGIN_PASSWORD no Netlify (mínimo 12 caracteres).' }, cors);
    }
    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'Corpo JSON inválido.' }, cors); }
    if (!safeEqual(body?.password, configuredPassword)) {
      return json(401, { error: 'Senha incorreta.' }, cors);
    }
    try {
      const token = createSession();
      return json(200, { ok: true, expiresIn: SESSION_TTL_SECONDS }, { ...cors, 'Set-Cookie': sessionCookie(token) });
    } catch (error) {
      console.error('CRM session setup error:', error?.message || 'unknown error');
      return json(503, { error: 'Sessão não configurada no servidor. Confira CRM_SESSION_SECRET.' }, cors);
    }
  }

  if (action === 'logout' && request.method === 'POST') {
    return json(200, { ok: true }, { ...cors, 'Set-Cookie': clearSessionCookie() });
  }

  if (action === 'session' && request.method === 'GET') {
    if (!process.env.CRM_LOGIN_PASSWORD || !process.env.CRM_SESSION_SECRET) {
      return json(503, { authenticated: false, error: 'Autenticação ainda não configurada no Netlify.' }, cors);
    }
    return validSession(request)
      ? json(200, { authenticated: true }, cors)
      : json(401, { authenticated: false }, cors);
  }


  if (action === 'automation-queue' && request.method === 'GET') {
    if (!validSession(request)) return json(401, { error: 'Sessão expirada ou não autenticada.' }, cors);
    try {
      const rows = await supabaseQueueRequest('GET',
        '?status=eq.awaiting_operator&select=id,event_type,source_type,source_id,payload,scheduled_at,created_at,attempts&order=scheduled_at.asc&limit=100');
      return json(200, { items: Array.isArray(rows) ? rows : [] }, cors);
    } catch (error) {
      return json(error?.status || 500, { error: error?.message || 'Não foi possível consultar a fila.' }, cors);
    }
  }

  if (action === 'automation-queue-result' && request.method === 'POST') {
    if (!validSession(request)) return json(401, { error: 'Sessão expirada ou não autenticada.' }, cors);
    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'Corpo JSON inválido.' }, cors); }
    const id = String(body?.id || '').trim();
    const outcome = String(body?.outcome || '').trim();
    const note = String(body?.note || '').trim().slice(0, 500);
    const allowedOutcomes = new Set(['contacted', 'no_answer', 'rescheduled', 'not_contacted']);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !allowedOutcomes.has(outcome)) {
      return json(400, { error: 'Identificador ou resultado inválido.' }, cors);
    }
    try {
      const base = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
      const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      const response = await fetch(`${base}/rest/v1/rpc/resolve_automation_queue_manual_result`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ p_queue_id: id, p_outcome: outcome, p_note: note, p_resolved_by: 'crm_operator' })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error('Não foi possível registrar o resultado e o histórico de forma atômica.');
      if (result?.conflict) return json(409, { error: 'A tarefa não está mais aguardando ação manual. Atualize a fila.' }, cors);
      return json(200, { ok: true, item: result?.item || result, outcome, message: 'Resultado manual registrado. Nenhuma mensagem foi enviada pelo sistema.' }, cors);
    } catch (error) {
      return json(error?.status || 500, { error: error?.message || 'Não foi possível registrar o resultado.' }, cors);
    }
  }

  if (!['GET', 'PUT'].includes(request.method)) {
    return json(405, { error: 'Método não permitido.' }, { ...cors, Allow: 'GET, PUT, POST, OPTIONS' });
  }

  if (!validSession(request)) return json(401, { error: 'Sessão expirada ou não autenticada. Entre novamente no CRM.' }, cors);

  try {
    if (request.method === 'GET') {
      const rows = await supabaseRequest('GET', '?id=eq.main&select=id,data,revision,updated_at');
      if (!Array.isArray(rows) || !rows.length) return json(500, { error: 'Estado principal do CRM não encontrado. Confira a tabela crm_app_state.' }, cors);
      return json(200, { data: rows[0].data, revision: Number(rows[0].revision), updatedAt: rows[0].updated_at }, cors);
    }

    const payload = await request.json();
    if (!payload || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      return json(400, { error: 'Corpo inválido: data deve ser um objeto.' }, cors);
    }
    if (!Number.isInteger(Number(payload.revision)) || Number(payload.revision) < 1) {
      return json(400, { error: 'Revisão ausente ou inválida. Recarregue os dados antes de salvar.' }, cors);
    }
    const nextRevision = Number(payload.revision) + 1;
    const rows = await supabaseRequest(
      'PATCH',
      `?id=eq.main&revision=eq.${Number(payload.revision)}&select=revision,updated_at`,
      { data: payload.data, revision: nextRevision, updated_at: new Date().toISOString(), updated_by: 'netlify-crm' }
    );
    if (!Array.isArray(rows) || !rows.length) {
      return json(409, { error: 'O CRM foi alterado em outra sessão. Atualize os dados antes de tentar novamente.' }, cors);
    }

    let automation = { acceptedEventIds: [], failures: [] };
    if (payload.automationEvents !== undefined) {
      try {
        automation = await enqueueAutomationEvents(payload.automationEvents);
      } catch (error) {
        automation = {
          acceptedEventIds: [],
          failures: [{ clientEventId: null, message: String(error?.message || 'Queue unavailable').slice(0, 200) }]
        };
      }
    }
    return json(200, {
      revision: Number(rows[0].revision),
      updatedAt: rows[0].updated_at,
      automation
    }, cors);
  } catch (error) {
    console.error('crm-state function error:', error?.message || 'unknown error');
    return json(error?.status || 500, { error: error?.message || 'Erro inesperado ao acessar o banco remoto.' }, cors);
  }
};
