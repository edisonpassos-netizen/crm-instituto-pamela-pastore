import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsAppOutboundConfig } from '../netlify/functions/lib/whatsapp-outbound-config.mjs';

const base = {
  WHATSAPP_ACCESS_TOKEN: 'synthetic-token',
  WHATSAPP_GRAPH_API_VERSION: 'v26.0'
};

test('outbound mode is fail-closed when no mode is enabled', () => {
  assert.throws(
    () => resolveWhatsAppOutboundConfig({ recipient_phone: '5515999999999' }, { ...base }),
    /OUTBOUND_MODE está desabilitado/
  );
});

test('test mode preserves explicit allowlist protection', () => {
  const env = {
    ...base,
    WHATSAPP_TEST_MODE: 'true',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_TEMPLATE_NAME: 'hello_world',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en_US',
    WHATSAPP_TEST_RECIPIENTS: '5515999999999'
  };
  const config = resolveWhatsAppOutboundConfig({ recipient_phone: '+55 (15) 99999-9999' }, env);
  assert.equal(config.mode, 'test');
  assert.equal(config.to, '5515999999999');
  assert.equal(config.phoneNumberId, '123456789');
  assert.equal(config.templateName, 'hello_world');

  assert.throws(
    () => resolveWhatsAppOutboundConfig({ recipient_phone: '5515888888888' }, env),
    /não consta na lista de teste/
  );
});

test('production mode requires a second explicit enable switch', () => {
  const env = {
    ...base,
    WHATSAPP_OUTBOUND_MODE: 'production',
    WHATSAPP_PRODUCTION_PHONE_NUMBER_ID: '987654321',
    WHATSAPP_PRODUCTION_TEMPLATE_NAME: 'follow_up_ptbr',
    WHATSAPP_PRODUCTION_TEMPLATE_LANGUAGE: 'pt_BR',
    WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES: '55'
  };
  assert.throws(
    () => resolveWhatsAppOutboundConfig({ channel: 'whatsapp', recipient_phone: '5515999999999' }, env),
    /PRODUCTION_ENABLED não está habilitado/
  );
});

test('production mode uses production-only phone/template variables and country allowlist', () => {
  const env = {
    ...base,
    WHATSAPP_OUTBOUND_MODE: 'production',
    WHATSAPP_PRODUCTION_ENABLED: 'true',
    WHATSAPP_PRODUCTION_PHONE_NUMBER_ID: '987654321',
    WHATSAPP_PRODUCTION_TEMPLATE_NAME: 'follow_up_ptbr',
    WHATSAPP_PRODUCTION_TEMPLATE_LANGUAGE: 'pt_BR',
    WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES: '55'
  };
  const config = resolveWhatsAppOutboundConfig({ channel: 'whatsapp', recipient_phone: '5515999999999' }, env);
  assert.equal(config.mode, 'production');
  assert.equal(config.phoneNumberId, '987654321');
  assert.equal(config.templateName, 'follow_up_ptbr');
  assert.equal(config.languageCode, 'pt_BR');

  assert.throws(
    () => resolveWhatsAppOutboundConfig({ channel: 'whatsapp', recipient_phone: '14155550123' }, env),
    /país do destinatário não está autorizado/
  );
});

test('google review production jobs require their own approved template', () => {
  const env = {
    ...base,
    WHATSAPP_OUTBOUND_MODE: 'production',
    WHATSAPP_PRODUCTION_ENABLED: 'true',
    WHATSAPP_PRODUCTION_PHONE_NUMBER_ID: '987654321',
    WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_NAME: 'google_review_request_ptbr',
    WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_LANGUAGE: 'pt_BR',
    WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES: '55'
  };
  const config = resolveWhatsAppOutboundConfig({ channel: 'google_review', recipient_phone: '5515999999999' }, env);
  assert.equal(config.templateName, 'google_review_request_ptbr');
  assert.equal(config.languageCode, 'pt_BR');
});
