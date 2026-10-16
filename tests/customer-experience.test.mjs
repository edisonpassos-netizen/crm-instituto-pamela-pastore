import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCustomerExperienceResponse } from '../netlify/functions/lib/customer-experience.mjs';
import { resolveWhatsAppOutboundConfig } from '../netlify/functions/lib/whatsapp-outbound-config.mjs';

test('customer experience classifier recognizes only explicit supported answers', () => {
  assert.equal(classifyCustomerExperienceResponse({ responseKey: 'experience_very_good', textBody: 'Muito boa' }), 'very_good');
  assert.equal(classifyCustomerExperienceResponse({ textBody: 'Excelente' }), 'very_good', 'visible Meta quick-reply label must remain a safe fallback alias');
  assert.equal(classifyCustomerExperienceResponse({ responseKey: 'experience_good', textBody: 'Boa' }), 'good');
  assert.equal(classifyCustomerExperienceResponse({ responseKey: 'experience_needs_improvement', textBody: 'Poderia melhorar' }), 'needs_improvement');
  assert.equal(classifyCustomerExperienceResponse({ textBody: 'Poderia melhorar' }), 'needs_improvement');
  assert.equal(classifyCustomerExperienceResponse({ textBody: 'Tenho uma dúvida sobre horários' }), null);
  assert.equal(classifyCustomerExperienceResponse({ textBody: 'ruim' }), null, 'free-form negative text must not be auto-classified without an explicit supported answer');
});

test('production satisfaction request uses its own approved template', () => {
  const config = resolveWhatsAppOutboundConfig({
    event_type: 'satisfaction_request', channel: 'whatsapp', recipient_phone: '5515999999999'
  }, {
    WHATSAPP_OUTBOUND_MODE: 'production',
    WHATSAPP_PRODUCTION_ENABLED: 'true',
    WHATSAPP_ACCESS_TOKEN: 'synthetic-token',
    WHATSAPP_GRAPH_API_VERSION: 'v26.0',
    WHATSAPP_PRODUCTION_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_NAME: 'experiencia_pos_atendimento_v1',
    WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_LANGUAGE: 'pt_BR',
    WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_NAME: 'avaliacao_google_pos_atendimento_v1',
    WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES: '55'
  });
  assert.equal(config.templateName, 'experiencia_pos_atendimento_v1');
  assert.equal(config.languageCode, 'pt_BR');
});

test('review invitation uses review template and production is fail-closed without its enable switch', () => {
  const base = {
    WHATSAPP_OUTBOUND_MODE: 'production',
    WHATSAPP_ACCESS_TOKEN: 'synthetic-token',
    WHATSAPP_GRAPH_API_VERSION: 'v26.0',
    WHATSAPP_PRODUCTION_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_NAME: 'avaliacao_google_pos_atendimento_v1',
    WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_LANGUAGE: 'pt_BR',
    WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES: '55'
  };
  assert.throws(() => resolveWhatsAppOutboundConfig({ event_type: 'review_invitation', channel: 'google_review', recipient_phone: '5515999999999' }, base), /WHATSAPP_PRODUCTION_ENABLED/);
  const config = resolveWhatsAppOutboundConfig({ event_type: 'review_invitation', channel: 'google_review', recipient_phone: '5515999999999' }, { ...base, WHATSAPP_PRODUCTION_ENABLED: 'true' });
  assert.equal(config.templateName, 'avaliacao_google_pos_atendimento_v1');
});
