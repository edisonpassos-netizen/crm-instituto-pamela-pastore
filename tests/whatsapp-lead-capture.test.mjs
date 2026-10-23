import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCaptureWhatsAppLead } from '../netlify/functions/lib/whatsapp-lead-capture.mjs';
const msg = {phoneNumberId:'123',contactWaId:'5515999990001',type:'text'};
const env = {WHATSAPP_LEAD_CAPTURE_ENABLED:'true',WHATSAPP_LEAD_PHONE_NUMBER_IDS:'123'};
test('lead capture requires an explicit verified channel and enable flag', () => {
  assert.equal(shouldCaptureWhatsAppLead(msg,{}),false);
  assert.equal(shouldCaptureWhatsAppLead(msg,{...env,WHATSAPP_LEAD_CAPTURE_ENABLED:'false'}),false);
  assert.equal(shouldCaptureWhatsAppLead({...msg,phoneNumberId:'999'},env),false);
  assert.equal(shouldCaptureWhatsAppLead(msg,env),true);
});
test('lead capture skips survey replies, contextual replies, invalid phones and system events', () => {
  for (const extra of [{responseKey:'experience_good'},{contextMessageId:'survey-id'},{contactWaId:'123'},{type:'system'}])
    assert.equal(shouldCaptureWhatsAppLead({...msg,...extra},env),false);
});
