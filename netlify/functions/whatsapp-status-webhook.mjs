import { createHmac, timingSafeEqual } from 'node:crypto';
import { crmDatabaseConfig } from './lib/crm-database.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function equalText(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function verifySignature(rawBody, supplied, appSecret) {
  if (!supplied || !appSecret) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return equalText(expected, supplied);
}

function config() {
  return crmDatabaseConfig(process.env);
}

function serverHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function updateProviderStatus(messageId, status, timestamp, errorInfo = null) {
  const { url: base, key } = config();
  const query = new URLSearchParams({ provider_message_id: `eq.${messageId}` }).toString();
  const response = await fetch(`${base}/rest/v1/crm_automation_attempts?${query}`, {
    method: 'PATCH',
    headers: serverHeaders(key, {
      'Content-Type': 'application/json', Prefer: 'return=representation'
    }),
    body: JSON.stringify({
      provider_status: status,
      provider_status_at: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : new Date().toISOString(),
      provider_error_code: errorInfo?.code ? String(errorInfo.code).slice(0, 80) : null,
      provider_error_title: errorInfo?.title ? String(errorInfo.title).slice(0, 250) : null
    })
  });
  if (!response.ok) throw new Error(`Status persistence failed (HTTP ${response.status}).`);
  return await response.json().catch(() => []);
}

function extractInboundMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = String(value?.metadata?.phone_number_id || '').trim();
      const contacts = new Map(
        (Array.isArray(value?.contacts) ? value.contacts : [])
          .filter(contact => contact?.wa_id)
          .map(contact => [String(contact.wa_id), String(contact?.profile?.name || '').trim()])
      );
      for (const message of value?.messages || []) {
        const id = String(message?.id || '').trim();
        const from = String(message?.from || '').replace(/\D/g, '');
        const type = String(message?.type || '').trim();
        if (!id || !from || !type) continue;
        const timestamp = Number(message?.timestamp);
        messages.push({
          id,
          phoneNumberId,
          contactWaId: from,
          contactName: contacts.get(from) || '',
          type,
          textBody: type === 'text' ? String(message?.text?.body || '') : null,
          timestamp: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null,
          payload: message
        });
      }
    }
  }
  return messages;
}

async function persistInboundMessage(message) {
  const { url: base, key } = config();
  const response = await fetch(`${base}/rest/v1/rpc/ingest_whatsapp_inbound_message`, {
    method: 'POST',
    headers: serverHeaders(key, {
      'Content-Type': 'application/json', Accept: 'application/json'
    }),
    body: JSON.stringify({
      p_provider_message_id: message.id,
      p_phone_number_id: message.phoneNumberId || null,
      p_contact_wa_id: message.contactWaId,
      p_contact_name: message.contactName || null,
      p_message_type: message.type,
      p_text_body: message.textBody,
      p_provider_timestamp: message.timestamp,
      p_message_payload: message.payload || {}
    })
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(`Inbound message persistence failed (HTTP ${response.status}).`);
  return parsed || {};
}

export default async request => {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
        equalText(token, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    return json(403, { error: 'Webhook verification rejected.' });
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET || '')) {
    return json(401, { error: 'Invalid webhook signature.' });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json(400, { error: 'Invalid JSON payload.' }); }

  const statuses = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const item of change?.value?.statuses || []) {
        if (!item?.id || !['sent', 'delivered', 'read', 'failed'].includes(item.status)) continue;
        const err = Array.isArray(item.errors) ? item.errors[0] : null;
        statuses.push({ id: String(item.id), status: item.status, timestamp: item.timestamp, error: err });
      }
    }
  }
  const inboundMessages = extractInboundMessages(payload);

  try {
    let updated = 0;
    let unmatched = 0;
    let inserted = 0;
    let duplicates = 0;

    for (const item of statuses) {
      const rows = await updateProviderStatus(item.id, item.status, item.timestamp, item.error);
      if (rows.length) updated += rows.length;
      else unmatched += 1;
    }

    for (const message of inboundMessages) {
      const result = await persistInboundMessage(message);
      if (result?.inserted === true) inserted += 1;
      else duplicates += 1;
    }

    return json(200, {
      ok: true,
      statusesReceived: statuses.length,
      statusRowsUpdated: updated,
      statusRowsUnmatched: unmatched,
      messagesReceived: inboundMessages.length,
      messagesInserted: inserted,
      messagesDuplicate: duplicates
    });
  } catch (error) {
    console.error('WhatsApp webhook persistence failed:', error?.message || 'unknown');
    return json(503, { error: 'Webhook data could not be persisted; provider may retry webhook.' });
  }
};

export const __test = {
  verifySignature,
  updateProviderStatus,
  extractInboundMessages,
  persistInboundMessage,
  serverHeaders,
  config
};
