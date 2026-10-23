import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { crmDatabaseConfig, CRM_DATABASE_URL, CRM_PROJECT_REF } from './lib/crm-database.mjs';
import { enqueueAutomationEvents } from './lib/automation-enqueue.mjs';

const DEFAULT_ORIGIN = 'https://peppy-salamander-2d8776.netlify.app';
const SESSION_COOKIE = 'crm_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

const TABLE_URL = () => `${crmDatabaseConfig(process.env).url}/rest/v1/crm_app_state`;

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
  return requestOrigin === expected && ['GET', 'HEAD'].includes(request.method);
}

function corsHeaders(request) {
  const origin = (request.headers.get('origin') || '').trim().replace(/\/$/, '');
  const headers = {
    Vary: 'Origin',
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
  try {
    const token = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
    const parts = token.split('.');
    if (parts.length !== 2) return false;
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

function serverHeaders(key) {
  const headers = { apikey: key, Accept: 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function businessRecordCount(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  return ['leads', 'tasks', 'sales', 'attendances']
    .reduce((total, key) => total + (Array.isArray(data[key]) ? data[key].length : 0), 0);
}

function wouldEraseAllBusinessData(currentData, nextData) {
  return businessRecordCount(currentData) > 0 && businessRecordCount(nextData) === 0;
}

async function supabaseRequest(method, query = '', body = null) {
  const url = TABLE_URL() + query;
  const { url: supabaseUrl, key } = crmDatabaseConfig(process.env);
  const headers = serverHeaders(key);
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
      urlMatchesExpectedProject: supabaseUrl === CRM_DATABASE_URL
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

async function supabaseAutomationRequest(path, method = 'GET', body = null) {
  const { url: base, key } = crmDatabaseConfig(process.env);
  const headers = serverHeaders(key);
  const options = { method, headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${base}/rest/v1/${path}`, options);
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const err = new Error(`Supabase respondeu HTTP ${response.status} ao acessar a automação.`);
    err.status = response.status;
    throw err;
  }
  return parsed;
}

export default async request => {
  const cors = corsHeaders(request);
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  if (request.method === 'OPTIONS') {
    if (!allowedOrigin(request)) return json(403, { error: 'Origem não autorizada. Configure CRM_ALLOWED_ORIGIN.' });
    return new Response(null, { status: 204, headers: cors });
  }

  if (!allowedOrigin(request)) return json(403, { error: 'Origem não autorizada. Confira a URL configurada em CRM_ALLOWED_ORIGIN.' }, cors);

  if (action === 'health' && request.method === 'GET') {
    try {
      const rows = await supabaseRequest('GET', '?id=eq.main&select=id');
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== 'main') {
        return json(503, { ok: false, error: 'Estado principal do CRM indisponível.' }, cors);
      }
      return json(200, { ok: true, databaseProjectRef: CRM_PROJECT_REF }, cors);
    } catch {
      return json(503, { ok: false, error: 'Conexão do CRM indisponível. Confira a URL e a chave secreta do projeto exclusivo.' }, cors);
    }
  }

  if (action === 'login' && request.method === 'POST') {
    const configuredPassword = process.env.CRM_LOGIN_PASSWORD || '';
    if (!configuredPassword || configuredPassword.length < 12) {
      return json(503, { error: 'Acesso ainda não configurado. Defina CRM_LOGIN_PASSWORD no Netlify (mínimo 12 caracteres).' }, cors);
    }
    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'Corpo JSON inválido.' }, cors); }
    if (!safeEqual(body?.password, configuredPassword)) return json(401, { error: 'Senha incorreta.' }, cors);
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
    return validSession(request) ? json(200, { authenticated: true }, cors) : json(401, { authenticated: false }, cors);
  }

  if (action === 'lead-experience' && request.method === 'GET') {
    if (!validSession(request)) return json(401, { error: 'Sessão expirada ou não autenticada.' }, cors);
    const leadId = String(url.searchParams.get('leadId') || '').trim();
    if (!leadId || leadId.length > 160) return json(400, { error: 'Lead inválido.' }, cors);
    try {
      const stateRows = await supabaseRequest('GET', '?id=eq.main&select=data');
      const data = stateRows?.[0]?.data;
      const leads = Array.isArray(data?.leads) ? data.leads : [];
      const lead = leads.find(item => String(item?.id || '') === leadId);
      if (!lead) return json(404, { error: 'Lead não encontrado.' }, cors);
      const phone = String(lead.phone || '').replace(/\D/g, '');
      const uniquePhone = phone.length >= 10 && phone.length <= 15
        && leads.filter(item => String(item?.phone || '').replace(/\D/g, '') === phone).length === 1;
      const fields = 'id,customer_id,source_type,source_id,service_name,status,satisfaction,response_text,requested_at,responded_at,recovery_queue_id,recovery_outcome,recovery_note,recovery_opened_at,recovery_resolved_at,review_invited_at,created_at';
      // Quote persisted identifiers as PostgREST literals, never as filter grammar.
      const exact = await supabaseAutomationRequest(`crm_customer_experience?customer_id=eq.${encodeURIComponent(JSON.stringify(leadId))}&select=${fields}&order=created_at.desc&limit=50`);
      let fallback = [];
      if (uniquePhone) {
        fallback = await supabaseAutomationRequest(`crm_customer_experience?recipient_phone=eq.${phone}&customer_id=is.null&select=${fields}&order=created_at.desc&limit=50`);
      }
      const attendanceIds = new Set((Array.isArray(data?.attendances) ? data.attendances : [])
        .filter(item => String(item?.leadId || '') === leadId).map(item => String(item.id)));
      const rows = [...(Array.isArray(exact) ? exact : []), ...(Array.isArray(fallback) ? fallback : [])]
        .filter(item => item.customer_id === leadId || (!item.customer_id && (
          item.source_type !== 'attendance' || attendanceIds.has(String(item.source_id)))))
        .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50);
      const queueIds = rows.map(item => item.recovery_queue_id).filter(id => /^[0-9a-f-]{36}$/i.test(id || ''));
      const queueRows = queueIds.length ? await supabaseAutomationRequest(`crm_automation_queue?id=in.(${queueIds.join(',')})&select=id,status`) : [];
      const items = rows.map(({ customer_id, source_type, source_id, ...item }) => ({
        ...item,
        recovery_queue_status: (Array.isArray(queueRows) ? queueRows : []).find(q => q.id === item.recovery_queue_id)?.status || null
      }));
      return json(200, { items, phoneAssociationAmbiguous: Boolean(phone && !uniquePhone) }, cors);
    } catch (error) {
      return json(error?.status || 500, { error: 'Não foi possível carregar o histórico de experiência.' }, cors);
    }
  }

  if (action === 'whatsapp-messages' && request.method === 'GET') {
    if (!validSession(request)) return json(401, { error: 'Sessão expirada. Entre novamente no CRM.' }, cors);
    const phone = String(url.searchParams.get('phone') || '');
    if (phone && !/^\\d{10,15}$/.test(phone)) return json(400, { error: 'Telefone inválido.' }, cors);
    try {
      const filter = phone ? '&contact_wa_id=eq.' + phone : '';
      const rows = await supabaseAutomationRequest('crm_whatsapp_messages?select=id,direction,phone_number_id,contact_wa_id,contact_name,message_type,text_body,provider_timestamp,created_at&order=created_at.desc,id.desc&limit=200' + filter);
      return json(200, { items: Array.isArray(rows) ? rows : [], limit: 200,
        leadCaptureEnabled: process.env.WHATSAPP_LEAD_CAPTURE_ENABLED === 'true',
        outboundMode: ['test','production'].includes(process.env.WHATSAPP_OUTBOUND_MODE) ? process.env.WHATSAPP_OUTBOUND_MODE : 'disabled'
      }, cors);
    } catch {
      return json(503, { error: 'Não foi possível consultar as mensagens. Tente atualizar.' }, cors);
    }
  }

  if (action === 'automation-queue' && request.method === 'GET') {
    if (!validSession(request)) return json(401, { error: 'Sessão expirada ou não autenticada.' }, cors);
    const queueId = url.searchParams.get('queueId');
    if (queueId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(queueId)) {
      return json(400, { error: 'Caso inválido.' }, cors);
    }
    try {
      const rows = await supabaseAutomationRequest(
        'crm_automation_queue?status=eq.awaiting_operator' + (queueId ? `&id=eq.${queueId}` : '') + '&select=id,event_type,source_type,source_id,payload,scheduled_at,created_at,attempts&order=scheduled_at.asc&limit=100'
      );
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
    const eventType = String(body?.eventType || 'lead_follow_up_requested').trim();
    const outcome = String(body?.outcome || '').trim();
    const note = String(body?.note || '').trim().slice(0, 500);
    const rescheduleDate = String(body?.rescheduleDate || '').trim();
    const rescheduleTime = String(body?.rescheduleTime || '').trim();
    const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    const recovery = eventType === 'service_recovery_required';
    const allowedOutcomes = recovery
      ? new Set(['resolved', 'unresolved', 'rescheduled'])
      : new Set(['contacted', 'no_answer', 'rescheduled', 'not_contacted']);
    if (!validId || !allowedOutcomes.has(outcome)) {
      return json(400, { error: 'Identificador ou resultado inválido.' }, cors);
    }
    if (outcome === 'rescheduled') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rescheduleDate) || !Number.isFinite(Date.parse(rescheduleDate + 'T12:00:00.000Z'))) {
        return json(400, { error: 'Informe uma nova data válida para o retorno.' }, cors);
      }
      const today = new Date().toISOString().slice(0, 10);
      if (rescheduleDate < today) return json(400, { error: 'A nova data do retorno não pode estar no passado.' }, cors);
      if (!recovery && rescheduleTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rescheduleTime)) {
        return json(400, { error: 'Informe um horário válido para o retorno no formato HH:MM.' }, cors);
      }
    }
    try {
      const rpcName = recovery ? 'rpc/resolve_customer_experience_recovery' : 'rpc/resolve_automation_queue_manual_result_v3';
      const rpcBody = {
        p_queue_id: id,
        p_outcome: outcome,
        p_note: note,
        p_resolved_by: 'crm_operator',
        p_reschedule_date: outcome === 'rescheduled' ? rescheduleDate : null
      };
      if (!recovery) rpcBody.p_reschedule_time = outcome === 'rescheduled' ? (rescheduleTime || null) : null;
      const result = await supabaseAutomationRequest(rpcName, 'POST', rpcBody);
      if (result?.conflict) return json(409, { error: 'A tarefa, experiência ou fila mudou desde a última atualização. Atualize a fila e tente novamente.' }, cors);
      const message = recovery
        ? outcome === 'rescheduled'
          ? 'Recuperação reagendada. Nenhuma mensagem foi enviada automaticamente.'
          : 'Recuperação registrada. O convite neutro de avaliação ficou preparado para a etapa posterior do fluxo.'
        : outcome === 'rescheduled'
          ? `Resultado registrado e novo follow-up criado para ${rescheduleDate}${rescheduleTime ? ` às ${rescheduleTime}` : ''}. Nenhuma mensagem foi enviada.`
          : 'Resultado manual registrado e tarefa concluída no CRM. Nenhuma mensagem foi enviada pelo sistema.';
      return json(200, {
        ok: true,
        item: result?.item || result,
        eventType,
        outcome,
        appRevision: Number(result?.appRevision || 0) || null,
        rescheduledTaskId: result?.rescheduledTaskId || null,
        rescheduleDate: result?.rescheduleDate || null,
        rescheduleTime: result?.rescheduleTime || null,
        reviewScheduled: result?.reviewScheduled === true,
        message
      }, cors);
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
    if (payload.automationEvents !== undefined && (!Array.isArray(payload.automationEvents) || payload.automationEvents.length > 50)) {
      return json(400, { error: 'automationEvents deve ser uma lista com no máximo 50 itens.' }, cors);
    }

    const currentRows = await supabaseRequest('GET', '?id=eq.main&select=data,revision');
    if (!Array.isArray(currentRows) || currentRows.length !== 1) {
      return json(503, { error: 'Não foi possível validar o estado atual antes de salvar.' }, cors);
    }
    const currentRevision = Number(currentRows[0].revision);
    if (currentRevision !== Number(payload.revision)) {
      return json(409, { error: 'O CRM foi alterado em outra sessão. Atualize os dados antes de tentar novamente.' }, cors);
    }
    if (wouldEraseAllBusinessData(currentRows[0].data, payload.data)) {
      return json(409, {
        error: 'Gravação bloqueada para evitar apagar todos os dados da nuvem. Use um fluxo administrativo explícito para uma limpeza total.'
      }, cors);
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

export const __test = { businessRecordCount, wouldEraseAllBusinessData };

