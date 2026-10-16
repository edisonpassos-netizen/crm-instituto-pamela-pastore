import { toAutomationCommand } from './automation-event-adapter.mjs';

function config() {
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !key || key.startsWith('sb_publishable_')) throw new Error('Supabase server credentials are unavailable.');
  return { base, key };
}

function serverHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function customerExperienceEnabled(env = process.env) {
  return String(env.CUSTOMER_EXPERIENCE_ENABLED || '').trim().toLowerCase() === 'true';
}

async function persistedCrmState(base, key) {
  const response = await fetch(`${base}/rest/v1/crm_app_state?id=eq.main&select=data`, {
    method: 'GET',
    headers: serverHeaders(key, { Accept: 'application/json' })
  });
  if (!response.ok) throw new Error(`Could not verify persisted CRM state (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]?.data || typeof rows[0].data !== 'object') {
    throw new Error('Persisted CRM state is unavailable; automation request not enqueued.');
  }
  return rows[0].data;
}

async function rpc(base, key, name, body) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serverHeaders(key, { 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(`RPC ${name} HTTP ${response.status}: ${raw.slice(0, 160)}`);
  return parsed;
}

async function verifiedExperienceCommand(command, data, base, key) {
  const attendanceId = command.source_id;
  const attendance = Array.isArray(data.attendances)
    ? data.attendances.find(item => String(item?.id || '') === attendanceId)
    : null;
  const optedIn = attendance?.experienceConsent === true || attendance?.reviewConsent === true;
  const consentAt = attendance?.experienceConsentAt || attendance?.consentAt || null;
  if (!attendance || attendance.status !== 'Concluído' || !optedIn || !consentAt) {
    throw new Error('Attendance is not completed with recorded customer contact consent.');
  }

  const lead = Array.isArray(data.leads)
    ? data.leads.find(item => String(item?.id || '') === String(attendance.leadId || ''))
    : null;
  if (!lead) throw new Error('Attendance customer is missing from persisted CRM state.');

  const phone = String(lead.phone || '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) throw new Error('Customer phone is invalid.');

  const firstName = String(lead.name || '').trim().split(/\s+/)[0] || 'Cliente';
  const serviceName = String(
    attendance.serviceName || attendance.service || attendance.type || attendance.procedure || attendance.modality || 'Atendimento'
  ).trim().slice(0, 200) || 'Atendimento';

  const experienceId = await rpc(base, key, 'register_customer_experience_request', {
    p_source_type: 'attendance',
    p_source_id: attendanceId,
    p_customer_id: String(lead.id || ''),
    p_recipient_phone: phone,
    p_first_name: firstName,
    p_service_name: serviceName,
    p_metadata: {
      attendance_id: attendanceId,
      consent_at: String(consentAt),
      consent_source: attendance.experienceConsent === true ? 'experienceConsent' : 'legacyReviewConsent'
    }
  });
  if (typeof experienceId !== 'string' || !experienceId) {
    throw new Error('Customer experience record could not be created.');
  }

  return {
    ...command,
    dedupe_key: `crm:satisfaction_request:experience:${experienceId}`,
    source_type: 'customer_experience',
    source_id: experienceId,
    recipient_phone: phone,
    payload: {
      ...command.payload,
      experience_id: experienceId,
      attendance_id: attendanceId,
      customer_id: String(lead.id || ''),
      first_name: firstName,
      service_name: serviceName,
      customer_opt_in: true,
      consent_at: String(consentAt),
      template_parameters: [firstName, serviceName]
    }
  };
}

/**
 * Enqueues only explicit, allow-listed domain events supplied alongside a
 * successful CRM state save. Never derives events from JSON snapshots.
 * Client event IDs are echoed back so the caller can safely retain failed items.
 *
 * Customer-experience events are intentionally consumed as no-ops while the
 * module feature gate is disabled. This prevents old surveys from accumulating
 * and unexpectedly sending later when external automation is enabled.
 */
export async function enqueueAutomationEvents(events = []) {
  if (!Array.isArray(events) || events.length > 50) throw new Error('automationEvents must be an array of at most 50 items.');
  const { base, key } = config();
  const acceptedEventIds = [];
  const failures = [];
  let crmState = null;
  for (const event of events) {
    const clientEventId = String(event?.clientEventId || '').trim();
    try {
      if (!clientEventId || clientEventId.length > 128) throw new Error('Invalid client event ID.');
      let command = toAutomationCommand(event);
      if (command.event_type === 'satisfaction_request') {
        if (!customerExperienceEnabled()) {
          acceptedEventIds.push(clientEventId);
          continue;
        }
        crmState = crmState || await persistedCrmState(base, key);
        command = await verifiedExperienceCommand(command, crmState, base, key);
      }
      const response = await fetch(`${base}/rest/v1/rpc/enqueue_crm_automation`, {
        method: 'POST',
        headers: serverHeaders(key, {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }),
        body: JSON.stringify({
          p_dedupe_key: command.dedupe_key,
          p_event_type: command.event_type,
          p_source_type: command.source_type,
          p_source_id: command.source_id,
          p_recipient_phone: command.recipient_phone,
          p_payload: command.payload,
          p_channel: command.channel,
          p_scheduled_at: command.scheduled_at,
          p_max_attempts: command.max_attempts
        })
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Queue RPC HTTP ${response.status}: ${text.slice(0, 160)}`);
      acceptedEventIds.push(clientEventId);
    } catch (error) {
      failures.push({ clientEventId: clientEventId || null, message: String(error?.message || 'Enqueue failed').slice(0, 200) });
    }
  }
  return { acceptedEventIds, failures };
}

export const __test = { config, serverHeaders, customerExperienceEnabled, verifiedExperienceCommand, persistedCrmState, rpc };
