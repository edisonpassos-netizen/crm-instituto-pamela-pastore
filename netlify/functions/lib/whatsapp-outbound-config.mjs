const OUTBOUND_MODES = new Set(['disabled', 'test', 'production']);

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function csvDigits(value) {
  return String(value || '')
    .split(',')
    .map(digits)
    .filter(Boolean);
}

function outboundMode(env) {
  const explicit = String(env.WHATSAPP_OUTBOUND_MODE || '').trim().toLowerCase();
  if (explicit) {
    if (!OUTBOUND_MODES.has(explicit)) throw new Error('WHATSAPP_OUTBOUND_MODE inválido.');
    return explicit;
  }
  // Backward-compatible homologation behavior: the existing test switch may
  // opt into test mode, while every other configuration remains fail-closed.
  return env.WHATSAPP_TEST_MODE === 'true' ? 'test' : 'disabled';
}

function validateShared({ token, apiVersion, to }) {
  if (!token) throw new Error('WhatsApp não configurado: falta WHATSAPP_ACCESS_TOKEN.');
  if (!/^v\d+\.0$/.test(apiVersion)) throw new Error('WHATSAPP_GRAPH_API_VERSION inválida.');
  if (to.length < 10 || to.length > 15) throw new Error('Telefone do destinatário inválido.');
}

function validateTemplateConfig({ phoneNumberId, templateName }) {
  if (!/^\d+$/.test(phoneNumberId)) throw new Error('Phone Number ID do WhatsApp inválido.');
  if (!templateName) throw new Error('Modelo aprovado do WhatsApp não configurado.');
}

function productionTemplate(job, env) {
  if (job?.event_type === 'satisfaction_request') {
    return {
      templateName: env.WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_NAME,
      languageCode: env.WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_LANGUAGE || 'pt_BR'
    };
  }
  if (job?.channel === 'google_review' || job?.event_type === 'review_invitation') {
    return {
      templateName: env.WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_NAME,
      languageCode: env.WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_LANGUAGE || 'pt_BR'
    };
  }
  return {
    templateName: env.WHATSAPP_PRODUCTION_TEMPLATE_NAME,
    languageCode: env.WHATSAPP_PRODUCTION_TEMPLATE_LANGUAGE || 'pt_BR'
  };
}

export function resolveWhatsAppOutboundConfig(job, env = process.env) {
  const mode = outboundMode(env);
  if (mode === 'disabled') throw new Error('Envio bloqueado: WHATSAPP_OUTBOUND_MODE está desabilitado.');

  const token = String(env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const apiVersion = String(env.WHATSAPP_GRAPH_API_VERSION || 'v26.0').trim();
  const to = digits(job?.recipient_phone);
  validateShared({ token, apiVersion, to });

  if (mode === 'test') {
    if (env.WHATSAPP_TEST_MODE !== 'true') {
      throw new Error('Envio de teste bloqueado: WHATSAPP_TEST_MODE não está habilitado.');
    }
    const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    const templateName = String(env.WHATSAPP_TEMPLATE_NAME || '').trim();
    const languageCode = String(env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US').trim();
    const allowedRecipients = csvDigits(env.WHATSAPP_TEST_RECIPIENTS);
    validateTemplateConfig({ phoneNumberId, templateName });
    if (!allowedRecipients.includes(to)) {
      throw new Error('Envio bloqueado: destinatário não consta na lista de teste.');
    }
    return { mode, token, apiVersion, to, phoneNumberId, templateName, languageCode };
  }

  if (env.WHATSAPP_PRODUCTION_ENABLED !== 'true') {
    throw new Error('Envio de produção bloqueado: WHATSAPP_PRODUCTION_ENABLED não está habilitado.');
  }

  const phoneNumberId = String(env.WHATSAPP_PRODUCTION_PHONE_NUMBER_ID || '').trim();
  const selected = productionTemplate(job, env);
  const templateName = String(selected.templateName || '').trim();
  const languageCode = String(selected.languageCode || 'pt_BR').trim();
  const allowedCountryCodes = csvDigits(env.WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES);

  validateTemplateConfig({ phoneNumberId, templateName });
  if (!allowedCountryCodes.length) {
    throw new Error('Envio de produção bloqueado: configure WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES.');
  }
  if (!allowedCountryCodes.some(code => to.startsWith(code))) {
    throw new Error('Envio de produção bloqueado: país do destinatário não está autorizado.');
  }

  return { mode, token, apiVersion, to, phoneNumberId, templateName, languageCode };
}

export const __test = { digits, csvDigits, outboundMode, productionTemplate };
