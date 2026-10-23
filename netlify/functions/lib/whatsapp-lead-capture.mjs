// Lead capture is separate from message storage and requires a verified channel.
export function shouldCaptureWhatsAppLead(message, env = process.env) {
  if (env.WHATSAPP_LEAD_CAPTURE_ENABLED !== 'true') return false;
  const allowed = String(env.WHATSAPP_LEAD_PHONE_NUMBER_IDS || '')
    .split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
  return allowed.includes(message.phoneNumberId)
    && /^55[1-9][0-9]\d{8,9}$/.test(message.contactWaId)
    && !message.contextMessageId
    && !message.responseKey
    && ['text', 'image', 'audio', 'video', 'document'].includes(message.type);
}
