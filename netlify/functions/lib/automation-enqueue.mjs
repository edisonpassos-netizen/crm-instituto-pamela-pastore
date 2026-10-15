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

async function persistedCrmState(base, key) {
  const response = await fetch(`${base}/rest/v1/crm_app_state?id=eq.main&select=data`, {
    method: 'GET',
    headers: serverHeaders(key, { Accept: 'application/json' })
  });
  if (!response.ok) throw new Error(`Could not verify persisted CRM state (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]?.data || typeof rows[0].data !== 'object') {
    throw new Error('Persisted CRM state is unavailable; review request not enqueued.');
  }
  return rows[0].data;
}

function verifiedReviewCommand(command, data) {
  const attendanceId = command.source_id;
  const attendance = Array.isArray(data.attendances)
    ? data.attendances.find(item => String(item?.id || '') === attendanceId)
    : null;
  if (!attendance || attendance.status !== 'Concluído' || attendance.reviewConsent !== true || !attendance.consentAt) {
    throw new Error('Attendance is not completed with recorded review consent.');
  }
  const lead = Array.isArray(data.leads)
    ? data.leads.find(item => String(item?.id || '') === String(attendance.leadId || ''))
    : null;
  if (!lead) throw new Error('Attendance customer is missing from persisted CRM state.');
  const phone = String(lead.phone || '').replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) throw new Error('Customer phone is invalid.');
  let reviewUrl;
  try {
    reviewUrl = new URL(String(data.settings?.reviewUrl || '').trim());
  } catch {
    throw new Error('Official Google review URL is missing or invalid.');
  }
  if (reviewUrl.protocol !== 'https:' || !reviewUrl.hostname) {
    throw new Error('Official Google review URL must use HTTPS.');
  }
  return {
    ...command,
    recipient_phone: phone,
    payload: {
      ...command.payload,
      attendance_id: attendanceId,
      attendance_status: 'completed',
      customer_opt_in: true,
      consent_at: attendance.consentAt,
      customer_id: String(lead.id),
      first_name: String(lead.name || '').trim().split(/\s+/)[0] || '',
      google_review_url: reviewUrl.toString(),
      template_parameters: [String(lead.name || '').trim().split(/\s+/)[0] || 'Olá', reviewUrl.toString()]
    }
  };
}

/**
 * Enqueues only explicit, allow-listed domain events supplied alongside a
 * successful CRM state save. Never derives events from JSON snapshots.
 * Client event IDs are echoed back so the caller can safely retain failed items.
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
      if (command.event_type === 'service_completed') {
        crmState = crmState || await persistedCrmState(base, key);
        command = verifiedReviewCommand(command, crmState);
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

export const __test = { config, serverHeaders };
