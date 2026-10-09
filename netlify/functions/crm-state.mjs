import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

function expectedOrigin() {
  return (process.env.CRM_ALLOWED_ORIGIN || DEFAULT_ORIGIN).trim().replace(/\/$/, '');
}

function allowedOrigin(request) {
  const expected = expectedOrigin();
  const origin = (request.headers.get('origin') || '').trim().replace(/\/$/, '');
  let requestOrigin = '';
  try { requestOrigin = new URL(request.url).origin.replace(/\/$/, ''); } catch {}
  if (!expected) return false;
  if (origin) return origin === expected;
  // Same-origin GETs may omit Origin. Never allow an origin-less write.
  return requestOrigin === expected && ['GET', 'HEAD'].includes(request.method);
}

function corsHeaders(request) {
  const origin = (request.headers.get('origin') || '').trim().replace(/\/$/, '');
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Access-Control-Allow-Credentials': 'true'
  };
  if (origin && origin === expectedOrigin()) headers['Access-Control-Allow-Origin'] = origin;
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
  const token = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
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
    const err = new Error('A chave recebida pela função do CRM é pública. No Netlify, configure a chave sb_secret_ em SUPABASE_SERVICE_ROLE_KEY com escopo Functions e contexto Production; depois publique novamente.');
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
    // Log only Supabase's non-secret error details; never log request headers or keys.
    console.error('CRM Supabase request failed:', {
      status: response.status,
      code: parsed?.code || null,
      message: parsed?.message || null,
      keyLooksSecret: key.startsWith('sb_secret_'),
      keyLooksLegacyServiceRole: key.startsWith('eyJ'),
      urlMatchesExpectedProject: supabaseUrl === 'https://pposribyzhxyupbxrpfo.supabase.co'
    });
    const detail = response.status === 401
      ? 'Supabase recusou a chave configurada no servidor (HTTP 401). Confira se SUPABASE_SERVICE_ROLE_KEY é a chave secreta do mesmo projeto indicado em SUPABASE_URL.'
      : `Supabase respondeu HTTP ${response.status}.`;
    const err = new Error(detail);
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
    return json(200, { revision: Number(rows[0].revision), updatedAt: rows[0].updated_at }, cors);
  } catch (error) {
    console.error('crm-state function error:', error?.message || 'unknown error');
    return json(error?.status || 500, { error: error?.message || 'Erro inesperado ao acessar o banco remoto.' }, cors);
  }
};
