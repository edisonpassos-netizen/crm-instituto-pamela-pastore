const TABLE_URL = () => {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/rest/v1/crm_app_state`;
};

const json = (statusCode, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
});

function allowedOrigin(request) {
  const expected = (process.env.CRM_ALLOWED_ORIGIN || 'https://peppy-salamander-2d8776.netlify.app').trim().replace(/\/$/, '');
  const origin = (request.headers.get('origin') || '').trim().replace(/\/$/, '');
  // Same-origin GET/HEAD requests may omit Origin; validate the function URL in that case.
  let requestOrigin = '';
  try { requestOrigin = new URL(request.url).origin.replace(/\/$/, ''); } catch {}
  if (!expected) return false;
  if (origin) return origin === expected;
  return requestOrigin === expected && ['GET', 'HEAD'].includes(request.method);
}

function corsHeaders(request) {
  const origin = (request.headers.get('origin') || '').trim().replace(/\/$/, '');
  const headers = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

async function supabaseRequest(method, query = '', body = null) {
  const url = TABLE_URL() + query;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !key) throw new Error('Configuração do Supabase incompleta no servidor.');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const options = { method, headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    const err = new Error(`Supabase respondeu HTTP ${response.status}.`);
    err.status = response.status;
    throw err;
  }
  return parsed;
}

export default async (request) => {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') {
    if (!allowedOrigin(request)) return json(403, { error: 'Origem não autorizada. Configure CRM_ALLOWED_ORIGIN.' });
    return new Response(null, { status: 204, headers: cors });
  }
  if (!['GET', 'PUT'].includes(request.method)) return json(405, { error: 'Método não permitido.' }, { Allow: 'GET, PUT, OPTIONS' });
  if (!allowedOrigin(request)) return json(403, { error: 'Origem não autorizada. Confira a URL configurada em CRM_ALLOWED_ORIGIN.' });
  // IMPORTANTE: Origin/CORS não é autenticação. Não usar com dados reais até adicionar autenticação/autorização real.

  try {
    if (request.method === 'GET') {
      const rows = await supabaseRequest('GET', '?id=eq.main&select=id,data,revision,updated_at');
      if (!Array.isArray(rows) || !rows.length) return json(500, { error: 'Estado principal do CRM não encontrado. Aplique a migration SQL.' }, cors);
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
