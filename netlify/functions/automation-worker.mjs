import { randomUUID } from 'node:crypto';
import { crmDatabaseConfig } from './lib/crm-database.mjs';
import { resolveWhatsAppOutboundConfig } from './lib/whatsapp-outbound-config.mjs';
import { resolveFollowUpDueAt, validFollowUpTime } from './lib/followup-schedule.mjs';

const DEFAULT_BATCH_SIZE = 10;
const RETRY_BASE_SECONDS = 60;
const MAX_ERROR_LENGTH = 500;

function supabaseConfig() {
  const { url, key } = crmDatabaseConfig(process.env);
  return { base: url, key };
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
  return job?.event_type === 'review_invitation'
    && job?.channel === 'google_review'
    && job?.source_type === 'customer_experience'
    && Boolean(job?.source_id)
    && Boolean(job?.recipient_phone);
}

async function getExperience(job) {
  const id = String(job?.source_id || job?.payload?.experience_id || '').trim();
  if (!id) return null;
  const rows = await dbRequest(`crm_customer_experience?id=eq.${encodeURIComponent(id)}&select=*`, 'GET');
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function verifySatisfactionRequest(job) {
  if (job?.event_type !== 'satisfaction_request' || job?.channel !== 'whatsapp' || job?.source_type !== 'customer_experience') {
    return { ok: false, reason: 'Evento de satisfação inválido.' };
  }
  const experience = await getExperience(job);
  if (!experience || experience.status !== 'pending_send') {
    return { ok: false, reason: 'Experiência não está pendente de envio.' };
  }
  const currentPhone = String(experience.recipient_phone || '').replace(/\D/g, '');
  const queuedPhone = String(job?.recipient_phone || '').replace(/\D/g, '');
  if (!currentPhone || currentPhone !== queuedPhone || job?.payload?.customer_opt_in !== true) {
    return { ok: false, reason: 'Telefone ou consentimento da experiência não corresponde ao registro atual.' };
  }
  return { ok: true, experience };
}

async function prepareReviewInvitation(job) {
  if (!isReviewEligible(job)) return { ok: false, reason: 'Evento de avaliação inválido.' };
  const experience = await getExperience(job);
  if (!experience || experience.status !== 'review_pending') {
    return { ok: false, reason: 'Experiência não está liberada para convite de avaliação.' };
  }
  const currentPhone = String(experience.recipient_phone || '').replace(/\D/g, '');
  const queuedPhone = String(job?.recipient_phone || '').replace(/\D/g, '');
  if (!currentPhone || currentPhone !== queuedPhone) {
    return { ok: false, reason: 'Telefone do convite não corresponde à experiência registrada.' };
  }
  const rows = await dbRequest('crm_app_state?id=eq.main&select=data', 'GET');
  const data = Array.isArray(rows) ? rows[0]?.data : null;
  let currentUrl;
  try { currentUrl = new URL(String(data?.settings?.reviewUrl || '').trim()); } catch {}
  if (!currentUrl || currentUrl.protocol !== 'https:') {
    return { ok: false, reason: 'Link oficial de avaliação do Google não está configurado.' };
  }
  const firstName = String(experience.first_name || job?.payload?.first_name || 'Cliente').trim().split(/\s+/)[0] || 'Cliente';
  return {
    ok: true,
    experience,
    sendJob: {
      ...job,
      payload: {
        ...(job.payload || {}),
        experience_id: String(experience.id),
        first_name: firstName,
        google_review_url: currentUrl.toString(),
        template_parameters: [firstName, currentUrl.toString()]
      }
    }
  };
}

async function verifyReviewAgainstStoredState(job) {
  return prepareReviewInvitation(job);
}

function reviewMessage(job) {
  const firstName = String(job.payload?.first_name || '').trim().split(/\s+/)[0] || 'Cliente';
  const link = job.payload?.google_review_url || '';
  return `Olá, ${firstName}! Se desejar compartilhar sua experiência com o Instituto Pâmela Pastore, este é o nosso link oficial de avaliação: ${link}`;
}

function templateComponents(job) {
  const p = job?.payload || {};
  const components = [];
  if (Array.isArray(p.template_parameters) && p.template_parameters.length) {
    components.push({
      type: 'body',
      parameters: p.template_parameters.map(value => ({ type: 'text', text: String(value).slice(0, 500) }))
    });
  }
  if (job?.event_type === 'satisfaction_request') {
    ['experience_very_good', 'experience_good', 'experience_needs_improvement'].forEach((payload, index) => {
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload }]
      });
    });
  }
  return components;
}

async function sendWhatsAppTemplate(job) {
  const {
    token,
    phoneNumberId,
    templateName,
    languageCode,
    apiVersion,
    to
  } = resolveWhatsAppOutboundConfig(job, process.env);

  const components = templateComponents(job);
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
  const providerMessageId = String(body?.messages?.[0]?.id || '').trim();
  if (!providerMessageId) {
    const error = new Error('Resultado de envio indeterminado: a API respondeu com sucesso sem identificador da mensagem; não repetir automaticamente.');
    error.code = 'DELIVERY_UNKNOWN';
    throw error;
  }
  return providerMessageId;
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

async function completeExperienceSend(job, providerMessageId) {
  let result;
  try {
    result = await dbRequest('rpc/complete_customer_experience_send', 'POST', {
      p_queue_id: job.id,
      p_provider_message_id: providerMessageId,
      p_kind: job.event_type
    });
  } catch (cause) {
    const error = new Error('Mensagem aceita pelo WhatsApp, mas a confirmação interna falhou; não repetir automaticamente.');
    error.code = 'DELIVERY_UNKNOWN';
    error.cause = cause;
    throw error;
  }
  if (result?.conflict) {
    const error = new Error('Mensagem aceita pelo WhatsApp, mas o estado interno mudou; não repetir automaticamente.');
    error.code = 'DELIVERY_UNKNOWN';
    throw error;
  }
  if (result?.attemptLogged !== true) {
    try {
      await logAttempt(job, 'succeeded', 'Aceito pela API oficial do WhatsApp e conciliado com a experiência.', providerMessageId);
    } catch (logError) {
      console.error('automation attempt log failed after finalized experience send:', logError?.message || 'unknown');
    }
  }
}

async function handleServiceRecovery(job) {
  const result = await dbRequest('rpc/prepare_customer_experience_recovery', 'POST', { p_queue_id: job.id });
  if (result?.conflict) {
    const detail = 'Recuperação não corresponde mais ao estado atual da experiência.';
    await logAttempt(job, 'skipped', detail);
    await updateJob(job, { status: 'cancelled', locked_at: null, last_error: detail });
    return;
  }
  try {
    await logAttempt(job, 'succeeded', 'Caso de experiência encaminhado para atendimento humano da recepção.');
  } catch (logError) {
    console.error('service recovery attempt log failed:', logError?.message || 'unknown');
  }
}

async function handleLeadFollowUp(job) {
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
  const taskDate = String(task.date || '').trim();
  const taskTime = String(task.time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate) || !validFollowUpTime(taskTime)) {
    const detail = 'Data ou horário do follow-up ausente ou inválido; corrigir a tarefa no CRM.';
    await logAttempt(job, 'failed', detail);
    await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
    return;
  }
  let dueAt;
  try {
    dueAt = resolveFollowUpDueAt(task, process.env);
  } catch {
    const detail = 'Data, horário ou fuso do follow-up inválido; corrigir a tarefa ou a configuração do CRM.';
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
  if (dueAt.getTime() > Date.now()) {
    const detail = taskTime
      ? 'Follow-up validado e reagendado para a data e horário cadastrados no CRM.'
      : 'Follow-up validado e reagendado para a data cadastrada no CRM.';
    await logAttempt(job, 'succeeded', detail);
    await updateJob(job, {
      status: 'pending', scheduled_at: dueAt.toISOString(), locked_at: null,
      last_error: null,
      payload: {
        ...(job.payload || {}),
        task_date: taskDate,
        task_time: taskTime || null,
        due_at: dueAt.toISOString(),
        lead_id: String(lead.id),
        lead_name: String(lead.name || '')
      }
    });
    return;
  }
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
        task_time: taskTime || null,
        due_at: dueAt.toISOString(),
        task_type: String(task.type || ''),
        note: String(task.note || '').slice(0, 500),
        prepared_at: new Date().toISOString()
      }
    }
  });
}

async function processJob(job) {
  try {
    if (job.channel === 'internal') {
      if (job.event_type === 'service_recovery_required' && job.source_type === 'customer_experience') {
        await handleServiceRecovery(job);
        return;
      }
      if (job.event_type === 'lead_follow_up_requested' && job.source_type === 'task' && job.source_id) {
        await handleLeadFollowUp(job);
        return;
      }
      const detail = 'Evento interno ainda não possui um reconciliador implementado.';
      await logAttempt(job, 'failed', detail);
      await updateJob(job, { status: 'dead_letter', locked_at: null, last_error: detail });
      return;
    }

    if (job.event_type === 'satisfaction_request') {
      const verification = await verifySatisfactionRequest(job);
      if (!verification.ok) {
        await logAttempt(job, 'skipped', verification.reason);
        await updateJob(job, { status: 'cancelled', locked_at: null, last_error: verification.reason });
        return;
      }
      const providerMessageId = await sendWhatsAppTemplate(job);
      await completeExperienceSend(job, providerMessageId);
      return;
    }

    if (job.channel === 'google_review') {
      const verification = await prepareReviewInvitation(job);
      if (!verification.ok) {
        await logAttempt(job, 'skipped', verification.reason);
        await updateJob(job, { status: 'cancelled', locked_at: null, last_error: verification.reason });
        return;
      }
      const providerMessageId = await sendWhatsAppTemplate(verification.sendJob);
      await completeExperienceSend(job, providerMessageId);
      return;
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

export const config = { schedule: '*/5 * * * *' };

export default async () => {
  const externalEnabled = process.env.AUTOMATIONS_ENABLED === 'true';
  const internalEnabled = process.env.INTERNAL_AUTOMATIONS_ENABLED === 'true';
  if (!externalEnabled && !internalEnabled) {
    return new Response(JSON.stringify({ ok: true, disabled: true }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  const mode = externalEnabled ? 'all' : 'internal_only';
  const claimRpc = externalEnabled ? 'rpc/claim_due_automation_jobs' : 'rpc/claim_due_internal_automation_jobs';
  const requestId = randomUUID();
  try {
    const jobs = await dbRequest(claimRpc, 'POST', {
      p_limit: Math.max(1, Math.min(50, Number(process.env.AUTOMATION_BATCH_SIZE) || DEFAULT_BATCH_SIZE))
    });
    const list = Array.isArray(jobs) ? jobs : [];
    for (const job of list) {
      try { await processJob(job); }
      catch (error) {
        console.error('automation job failed:', { requestId, jobId: job?.id, message: error?.message || 'unknown' });
      }
    }
    return new Response(JSON.stringify({ ok: true, mode, claimed: list.length, requestId }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('automation worker failed:', { requestId, mode, message: error?.message || 'unknown' });
    return new Response(JSON.stringify({ ok: false, mode, requestId }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};

export const __test = {
  retryDelaySeconds,
  isReviewEligible,
  reviewMessage,
  verifyReviewAgainstStoredState,
  verifySatisfactionRequest,
  prepareReviewInvitation,
  templateComponents,
  completeExperienceSend,
  handleServiceRecovery,
  processJob,
  sendWhatsAppTemplate,
  serverHeaders,
  supabaseConfig,
  getExperience
};