import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler from '../netlify/functions/whatsapp-status-webhook.mjs';

function signed(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function expected() {
  return {
    ok: true,
    statusesReceived: 0,
    statusRowsUpdated: 0,
    statusRowsUnmatched: 0,
    messagesReceived: 0,
    messagesInserted: 0,
    messagesDuplicate: 0,
    experienceResponsesClassified: 0,
    experienceResponsesMatched: 0,
    experienceRecoveriesQueued: 0,
    experienceReviewsQueued: 0
  };
}

async function runFixture(change) {
  const previousSecret = process.env.WHATSAPP_APP_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('coexistence-only event must not touch CRM persistence yet');
  };
  try {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'fixture-waba', changes: [change] }]
    });
    const response = await handler(new Request('https://test.invalid/.netlify/functions/whatsapp-status-webhook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) },
      body
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected());
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = previousSecret;
  }
}

test('coexistence message echoes are acknowledged without being mistaken for customer inbound replies', async () => {
  await runFixture({
    field: 'smb_message_echoes',
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: 'fixture-phone-id' },
      message_echoes: [{
        from: '5515996734292',
        to: '5515997601234',
        id: 'wamid.ECHO_FIXTURE',
        timestamp: '1792248000',
        type: 'text',
        text: { body: 'Boa' }
      }]
    }
  });
});

test('coexistence history and contact sync events are acknowledged without mutating CRM state', async () => {
  await runFixture({
    field: 'history',
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: 'fixture-phone-id' },
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [] }]
    }
  });
  await runFixture({
    field: 'smb_app_state_sync',
    value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: 'fixture-phone-id' },
      state_sync: [{ type: 'contact', action: 'add', contact: { full_name: 'Cliente Teste', phone_number: '5515997601234' } }]
    }
  });
});

test('coexistence account lifecycle notifications are acknowledged without side effects', async () => {
  await runFixture({
    field: 'account_update',
    value: { event: 'ACCOUNT_RECONNECTED' }
  });
});
