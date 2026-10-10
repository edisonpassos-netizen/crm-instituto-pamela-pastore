import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/automation-worker.mjs';

function fakeResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('WhatsApp success response returns provider message id using mocked fetch only', async () => {
  const previous = {
    token: process.env.WHATSAPP_ACCESS_TOKEN,
    phone: process.env.WHATSAPP_PHONE_NUMBER_ID,
    template: process.env.WHATSAPP_TEMPLATE_NAME,
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE,
    fetch: globalThis.fetch
  };
  Object.assign(process.env, {
    WHATSAPP_ACCESS_TOKEN: 'test-token-not-real',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_TEMPLATE_NAME: 'test_template',
    WHATSAPP_TEMPLATE_LANGUAGE: 'pt_BR'
  });
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return fakeResponse(200, { messages: [{ id: 'wamid.TEST_ONLY_123' }] });
  };
  try {
    const id = await __test.sendWhatsAppTemplate({ recipient_phone: '+55 (15) 99999-9999', payload: {} });
    assert.equal(id, 'wamid.TEST_ONLY_123');
    assert.match(captured.url, /^https:\/\/graph\.facebook\.com\/v23\.0\/123456789\/messages$/);
    assert.equal(JSON.parse(captured.options.body).to, '5515999999999');
    assert.equal(JSON.parse(captured.options.body).template.name, 'test_template');
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of Object.entries({
      WHATSAPP_ACCESS_TOKEN: previous.token,
      WHATSAPP_PHONE_NUMBER_ID: previous.phone,
      WHATSAPP_TEMPLATE_NAME: previous.template,
      WHATSAPP_TEMPLATE_LANGUAGE: previous.language
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('WhatsApp API rejection is surfaced without exposing credentials', async () => {
  const previous = {
    token: process.env.WHATSAPP_ACCESS_TOKEN,
    phone: process.env.WHATSAPP_PHONE_NUMBER_ID,
    template: process.env.WHATSAPP_TEMPLATE_NAME,
    fetch: globalThis.fetch
  };
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-not-real';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  process.env.WHATSAPP_TEMPLATE_NAME = 'test_template';
  globalThis.fetch = async () => fakeResponse(400, { error: { code: 132000, message: 'template parameter mismatch' } });
  try {
    await assert.rejects(
      __test.sendWhatsAppTemplate({ recipient_phone: '5515999999999', payload: {} }),
      error => error.status === 400 && /132000/.test(error.message) && !/test-token-not-real/.test(error.message)
    );
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.token === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN; else process.env.WHATSAPP_ACCESS_TOKEN = previous.token;
    if (previous.phone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID; else process.env.WHATSAPP_PHONE_NUMBER_ID = previous.phone;
    if (previous.template === undefined) delete process.env.WHATSAPP_TEMPLATE_NAME; else process.env.WHATSAPP_TEMPLATE_NAME = previous.template;
  }
});

test('ambiguous WhatsApp timeout enters delivery_unknown and is not automatically rescheduled', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    token: process.env.WHATSAPP_ACCESS_TOKEN,
    phone: process.env.WHATSAPP_PHONE_NUMBER_ID,
    template: process.env.WHATSAPP_TEMPLATE_NAME,
    fetch: globalThis.fetch
  };
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-not-real';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  process.env.WHATSAPP_TEMPLATE_NAME = 'test_template';
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).startsWith('https://graph.facebook.com/')) throw new TypeError('simulated socket timeout');
    return { ok: true, status: 201, text: async () => '[]' };
  };
  try {
    await __test.processJob({
      id: '00000000-0000-4000-8000-000000000099',
      channel: 'whatsapp',
      event_type: 'follow_up',
      recipient_phone: '5515999999999',
      attempts: 1,
      max_attempts: 3,
      payload: {}
    });
    const patch = requests.find(r => r.method === 'PATCH');
    assert.ok(patch);
    assert.equal(patch.body.status, 'delivery_unknown');
    assert.equal(patch.body.locked_at, null);
    assert.equal('scheduled_at' in patch.body, false);
    assert.ok(requests.some(r => r.url.includes('/crm_automation_attempts') && r.body?.outcome === 'failed'));
  } finally {
    globalThis.fetch = previous.fetch;
    const env = [
      ['SUPABASE_URL', previous.url], ['SUPABASE_SERVICE_ROLE_KEY', previous.key],
      ['WHATSAPP_ACCESS_TOKEN', previous.token], ['WHATSAPP_PHONE_NUMBER_ID', previous.phone],
      ['WHATSAPP_TEMPLATE_NAME', previous.template]
    ];
    for (const [key, value] of env) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
