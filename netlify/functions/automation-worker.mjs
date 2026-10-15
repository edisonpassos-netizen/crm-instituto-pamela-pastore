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

function serverHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function dbRequest(path, method = 'POST', body = {}) {
  const { base, key } = supabaseConfig();
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: serverHeaders(key, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation'
    }),
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
  return job?.event_type === 'service_completed'
    && p.attendance_status === 'completed'
    && p.customer_opt_in === true
    && typeof p.google_review_url === 'string'
    && /^https:\/\//i.test(p.google_review_url)
    && Boolean(job.recipient_phone);
}

async function verifyReviewAgainstStoredState(job) {
  const rows = await dbRequest('crm_app_state?id=eq.main&select=data', 'GET');
  const data = Array.isArray(rows) ? rows[0]?.data : null;
  const attendanceId = String(job?.payload?.attendance_id || job?.source_id || '');
  const attendance = Array.isArray(data?.attendances)
    ? data.attendances.find(item => String(item?.id || '') === attendanceId)
    : null;
  if (!attendance || attendance.status !== 'Concluído' || attendance.reviewConsent !== true || !attendance.consentAt) {
    return { ok: false, reason: 'Atendimento não está concluído ou não há consentimento registrado no CRM.' };
  }
  const lead = Array.isArray(data?.leads)
    ? data.leads.find(item => String(item?.id || '') === String(attendance.leadId || ''))
    : null;
  const currentPhone = String(lead?.phone || '').replace(/\D/g, '');
  const queuedPhone = String(job?.recipient_phone || '').replace(/\D/g, '');
  if (!lead || !currentPhone || currentPhone !== queuedPhone) {
    return { ok: false, reason: 'Telefone do cliente não corresponde ao estado atual do CRM.' };
  }
  let currentUrl;
  try { currentUrl = new URL(String(data?.settings?.reviewUrl || '').trim()); } catch {}
  if (!currentUrl || currentUrl.protocol !== 'https:' || currentUrl.toString() !== String(job?.payload?.google_review_url || '')) {
    return { ok: false, reason: 'Link oficial de avaliação não corresponde à configuração atual do CRM.' };
  }
  if (String(attendance.consentAt) !== String(job?.payload?.consent_at || '')) {
    return { ok: false, reason: 'Registro de consentimento mudou após o pedido entrar na fila.' };
  }
  return { ok: true, lead, attendance };
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
  const apiVersion = (process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0').trim();
  if (!token || !phoneNumberId || !templateName) {
    throw new Error('WhatsApp oficial não configurado: faltam credenciais ou modelo aprovado.');
  }
  if (!/^\d+$/.test(phoneNumberId)) throw new Error('WHATSAPP_PHONE_NUMBER_ID inválido.');
  if (!/^v\d+\.0$/.test(apiVersion)) throw new Error('WHATSAPP_GRAPH_API_VERSION inválida.');
  const to = String(job.recipient_phone || '').replace(/\D/g, '');
  if (to.length < 10 || to.length > 15) throw new Error('Telefone do destinatário inválido.');

  // This branch is test-only: outbound sends require an explicit test-mode
  // switch and a strict allowlist of operator-controlled test numbers.
  if (process.env.WHATSAPP_TEST_MODE !== 'true') {
    throw new Error('Envio bloqueado: WHATSAPP_TEST_MODE não está habilitado.');
  }
  const allowedRecipients = (process.env.WHATSAPP_TEST_RECIPIENTS || '')
    .split(',').map(value => value.replace(/\D/g, '')).filter(Boolean);
  if (!allowedRecipients.includes(to)) {
    throw new Error('Envio bloqueado: destinatário não consta na lista de teste.');
  }

  const p = job.payload || {};
  const components = [];
  if (p.template_parameters && Array.isArray(p.template_parameters) && p.template_parameters.length) {
    components.push({
      type: 'body',
      parameters: p.template_parameters.map(value => ({ type: 'text', text: String(value).slice(0, 500) }))
    });
  }
  let response;
  try {
    response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
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
  } catch (cause) {
    const error = new Error('Resultado de envio indeterminado: a conexão falhou após iniciar a chamada; não repetir automaticamente.');
    error.code = 'DELIVERY_UNKNOWN';
    error.cause = cause;
    throw error;
  }
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
    headers: serverHeaders(key, {
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Falha ao atualizar fila (HTTP ${response.status}).`);
}

async function processJob(job) {
  try {
    if (job.channel === 'google_review') {
      if (!isReviewEligible(job)) {
        await logAttempt(job, 'skipped', 'Atendimento não elegível para solicitação de avaliação.');
        await updateJob(job, { status: 'cancelled', locked_at: null, last_error: 'Atendimento não elegível.' });
        return;
      }
      const verification = await verifyReviewAgainstStoredState(job);
      if (!verification.ok) {
        await logAttempt(job, 'skipped', verification.reason);
        await updateJob(job, { status: 'cancelled', locked_at: null, last_error: verification.reason });
        return;
      }
    }

    if (job.channel === 'internal') {
      // A follow-up is created by the CRM before its event is enqueued.
      // Reconcile against the durable CRM snapshot instead of creating a
      // duplicate task or mutating the whole-state document from the worker.
      if (job.event_type !== 'lead_follow_up_requested' ||
          job.source_type !== 'task' || !job.source_id) {
        const detail = 'Evento interno ainda não possui um reconciliador implementado.';
        await logAttempt(job, 'failed', detail);
        await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
        return;
      }
      const rows = await dbRequest('crm_app_state?id=eq.main&select=data', 'GET');
      const data = Array.isArray(rows) ? rows[0]?.data : null;
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const exists = tasks.some(task => String(task?.id || '') === String(job.source_id));
      if (!exists) {
        const detail = 'Follow-up não encontrado no estado persistido do CRM; verificar sincronização.';
        await logAttempt(job, 'failed', detail);
        await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
        return;
      }
      const task = tasks.find(item => String(item?.id || '') === String(job.source_id));
      if (!task) {
        const detail = 'Follow-up não encontrado no estado persistido do CRM; verificar sincronização.';
        await logAttempt(job, 'failed', detail);
        await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
        return;
      }
      if (task.done === true) {
        const detail = 'Follow-up já concluído no CRM; nenhuma ação adicional necessária.';
        await logAttempt(job, 'skipped', detail);
        await updateJob(job, { status: 'cancelled', locked_at: null, last_error: detail });
        return;
      }
      const taskDate = String(task.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate) ||
          !Number.isFinite(Date.parse(taskDate + 'T12:00:00.000Z'))) {
        const detail = 'Data do follow-up ausente ou inválida; corrigir a tarefa no CRM.';
        await logAttempt(job, 'failed', detail);
        await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
        return;
      }
      const lead = Array.isArray(data?.leads)
        ? data.leads.find(item => String(item?.id || '') === String(task.leadId || ''))
        : null;
      if (!lead) {
        const detail = 'Lead associado ao follow-up não encontrado no CRM.';
        await logAttempt(job, 'failed', detail);
        await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
        return;
      }
      const phone = String(lead.phone || '').replace(/\D/g, '');
      if (phone.length < 10 || phone.length > 15) {
        const detail = 'Telefone do lead ausente ou inválido; follow-up requer ação manual após corrigir o cadastro.';
        await logAttempt(job, 'failed', detail);
        await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
        return;
      }
      const dueAt = new Date(taskDate + 'T12:00:00.000Z');
      if (dueAt.getTime() > Date.now()) {
        const detail = 'Follow-up validado e reagendado para a data cadastrada no CRM.';
        await logAttempt(job, 'succeeded', detail);
        await updateJob(job, {
          status: 'pending', scheduled_at: dueAt.toISOString(), locked_at: null,
          last_error: null,
          payload: { ...(job.payload || {}), task_date: taskDate, lead_id: String(lead.id), lead_name: String(lead.name || '') }
        });
        return;
      }
      // Queue the validated task for an operator; this path intentionally does
      // not contact the lead or claim that a WhatsApp message was sent.
      const detail = 'Follow-up validado e pronto para atendimento manual; nenhuma mensagem foi enviada automaticamente.';
      await logAttempt(job, 'succeeded', detail);
      await updateJob(job, {
        status: 'awaiting_operator', locked_at: null, last_error: null,
        payload: {
          ...(job.payload || {}),
          dispatch: {
            state: 'ready_for_manual_contact',
            task_id: String(task.id),
            lead_id: String(lead.id),
            lead_name: String(lead.name || ''),
            recipient_phone: phone,
            task_date: taskDate,
            task_type: String(task.type || ''),
            note: String(task.note || '').slice(0, 500),
            prepared_at: new Date().toISOString()
          }
        }
      });
      return;
    }

    // The adapter emits service_completed for this channel. Eligibility and
    // persisted consent are checked above; keep the channel/event contract aligned.
    if (job.channel === 'google_review' && job.event_type !== 'service_completed') {
      throw new Error('Canal de avaliação exige evento service_completed.');
    }
    const providerMessageId = await sendWhatsAppTemplate(job);
    await logAttempt(job, 'succeeded', 'Aceito pela API oficial do WhatsApp.', providerMessageId);
    await updateJob(job, {
      status: 'sent', locked_at: null, provider_message_id: providerMessageId,
      completed_at: new Date().toISOString(), last_error: null
    });
  } catch (error) {
    const message = String(error?.message || 'Falha desconhecida').slice(0, MAX_ERROR_LENGTH);
    const ambiguous = error?.code === 'DELIVERY_UNKNOWN';
    const terminal = job.attempts >= job.max_attempts;
    const nextStatus = ambiguous ? 'delivery_unknown' : terminal ? 'dead_letter' : 'retry';
    const nextAt = new Date(Date.now() + retryDelaySeconds(job.attempts) * 1000).toISOString();
    try { await logAttempt(job, ambiguous ? 'failed' : terminal ? 'failed' : 'retry_scheduled', message); } catch (logError) {
      console.error('automation attempt log failed:', logError?.message || 'unknown');
    }
    await updateJob(job, {
      status: nextStatus, locked_at: null, last_error: message,
      ...(terminal || ambiguous ? {} : { scheduled_at: nextAt })
    });
  }
}

// A five-minute cadence is sufficient for dated commercial follow-ups and avoids unnecessary production invocations.
export const config = { schedule: '*/5 * * * *' };

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

export const __test = { retryDelaySeconds, isReviewEligible, reviewMessage, verifyReviewAgainstStoredState, processJob, sendWhatsAppTemplate, serverHeaders };
