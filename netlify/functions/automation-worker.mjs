import { randomUUID } from 'node:crypto';

const DEFAULT_BATCH_SIZE = 10;
const RETRY_BASE_SECONDS = 60;
const MAX_ERROR_LENGTH = 500;

function supabaseConfig() {
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key || key.startsWith('sb_publishable_')) {
    throw new Error('Configuração secreta do Supabase ausente ou inválida.');
  }
  return { base, key };
}

async function dbRequest(path, method = 'POST', body = {}) {
  const { base, key } = supabaseConfig();
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation'
    },
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    const error = new Error(`Supabase HTTP ${response.status}: ${parsed?.message || 'falha na requisição'}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

function retryDelaySeconds(attempt) {
  return Math.min(6 * 60 * 60, RETRY_BASE_SECONDS * (2 ** Math.max(0, attempt - 1)));
}

function isReviewEligible(job) {
  const p = job?.payload || {};
  return job?.event_type === 'request_review'
    && p.attendance_status === 'completed'
    && p.customer_opt_in === true
    && typeof p.google_review_url === 'string'
    && /^https:\/\//i.test(p.google_review_url)
    && Boolean(job.recipient_phone);
}

function reviewMessage(job) {
  const firstName = String(job.payload?.first_name || '').trim().split(/\s+/)[0] || 'tudo bem';
  const link = job.payload.google_review_url;
  return `Olá, ${firstName}! Obrigado por escolher o Instituto Pâmela Pastore. Se desejar, conte como foi sua experiência neste link: ${link} Sua opinião nos ajuda a melhorar. Obrigado!`;
}

async function sendWhatsAppTemplate(job) {
  const token = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const templateName = (process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const languageCode = (process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR').trim();
  if (!token || !phoneNumberId || !templateName) {
    throw new Error('WhatsApp oficial não configurado: faltam credenciais ou modelo aprovado.');
  }
  if (!/^\d+$/.test(phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID inválido.');
  const to = String(job.recipient_phone || '').replace(/\D/g, '');
  if (to.length < 10 || to.length > 15) throw new Error('Telefone do destinatário inválido.');

  const p = job.payload || {};
  const components = [];
  if (p.template_parameters && Array.isArray(p.template_parameters) && p.template_parameters.length) {
    components.push({
      type: 'body',
      parameters: p.template_parameters.map(value => ({ type: 'text', text: String(value).slice(0, 500) }))
    });
  }
  const response = await fetch(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode }, ...(components.length ? { components } : {}) }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`WhatsApp API HTTP ${response.status}: ${body?.error?.code || 'falha no envio'}`);
    error.status = response.status;
    throw error;
  }
  return body?.messages?.[0]?.id || null;
}

async function logAttempt(job, outcome, detail = null, providerMessageId = null) {
  await dbRequest('crm_automation_attempts', 'POST', {
    queue_id: job.id,
    attempt_number: job.attempts,
    outcome,
    detail: detail ? String(detail).slice(0, MAX_ERROR_LENGTH) : null,
    provider_message_id: providerMessageId
  });
}

async function updateJob(job, patch) {
  const { base, key } = supabaseConfig();
  const response = await fetch(`${base}/rest/v1/crm_automation_queue?id=eq.${encodeURIComponent(job.id)}`, {
    method: 'PATCH',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Falha ao atualizar fila (HTTP ${response.status}).`);
}

async function processJob(job) {
  try {
    if (job.channel === 'google_review' && !isReviewEligible(job)) {
      await logAttempt(job, 'skipped', 'Atendimento não elegível para solicitação de avaliação.');
      await updateJob(job, { status: 'cancelled', locked_at: null, last_error: 'Atendimento não elegível.' });
      return;
    }

    if (job.channel === 'internal') {
      await logAttempt(job, 'succeeded', 'Tarefa interna processada.');
      await updateJob(job, { status: 'completed', locked_at: null, completed_at: new Date().toISOString(), last_error: null });
      return;
    }

    // External sends are intentionally blocked until an operator enables the worker.
    if (job.channel === 'google_review' && job.event_type !== 'request_review') {
      throw new Error('Canal de avaliação exige evento request_review.');
    }
    const providerMessageId = await sendWhatsAppTemplate(job);
    await logAttempt(job, 'succeeded', 'Aceito pela API oficial do WhatsApp.', providerMessageId);
    await updateJob(job, {
      status: 'sent', locked_at: null, provider_message_id: providerMessageId,
      completed_at: new Date().toISOString(), last_error: null
    });
  } catch (error) {
    const message = String(error?.message || 'Falha desconhecida').slice(0, MAX_ERROR_LENGTH);
    const terminal = job.attempts >= job.max_attempts;
    const nextStatus = terminal ? 'dead_letter' : 'retry';
    const nextAt = new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000).toISOString();
    try { await logAttempt(job, terminal ? 'failed' : 'retry_scheduled', message); } catch (logError) {
      console.error('automation attempt log failed:', logError?.message || 'unknown');
    }
    await updateJob(job, {
      status: nextStatus, locked_at: null, last_error: message,
      ...(terminal ? {} : { scheduled_at: nextAt })
    });
  }
}

export const config = { schedule: '* * * * *' };

export default async () => {
  if (process.env.AUTOMATIONS_ENABLED !== 'true') {
    return new Response(JSON.stringify({ ok: true, disabled: true }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  const requestId = randomUUID();
  try {
    const jobs = await dbRequest('rpc/claim_due_automation_jobs', 'POST', {
      p_limit: Math.max(1, Math.min(50, Number(process.env.AUTOMATION_BATCH_SIZE) || DEFAULT_BATCH_SIZE))
    });
    const list = Array.isArray(jobs) ? jobs : [];
    for (const job of list) {
      try { await processJob(job); }
      catch (error) {
        console.error('automation job failed:', { requestId, jobId: job?.id, message: error?.message || 'unknown' });
      }
    }
    return new Response(JSON.stringify({ ok: true, claimed: list.length, requestId }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('automation worker failed:', { requestId, message: error?.message || 'unknown' });
    return new Response(JSON.stringify({ ok: false, requestId }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};

export const __test = { retryDelaySeconds, isReviewEligible, reviewMessage, processJob };
