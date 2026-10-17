import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import handler from '../netlify/functions/crm-state.mjs';

const ORIGIN = 'https://peppy-salamander-2d8776.netlify.app';
const SECRET = 'test-session-secret-for-operator-queue-123456789';
const QUEUE_ID = '00000000-0000-4000-8000-000000000001';
const CRM_DB_URL = 'https://dxfzuxybubvnjertiowf.supabase.co';
const TEST_SERVER_KEY = 'sb_secret_test-only-not-real';

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `crm_session=${payload}.${signature}`;
}
function request(url, method = 'GET', body = null) {
  return new Request(url, { method, headers: { Origin: ORIGIN, Cookie: sessionCookie(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
function restore(previous) {
  globalThis.fetch = previous.fetch;
  for (const [key, value] of Object.entries(previous.env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
function envSnapshot(){return { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, CRM_SESSION_SECRET: process.env.CRM_SESSION_SECRET, CRM_ALLOWED_ORIGIN: process.env.CRM_ALLOWED_ORIGIN }}
function setup(){process.env.SUPABASE_URL=CRM_DB_URL;process.env.SUPABASE_SERVICE_ROLE_KEY=TEST_SERVER_KEY;process.env.CRM_SESSION_SECRET=SECRET;delete process.env.CRM_ALLOWED_ORIGIN}

test('lead history requires session and a persisted lead before querying experiences', async () => {
  const previous={fetch:globalThis.fetch,env:envSnapshot()};setup();const calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json([{data:{leads:[]}}])};
  try{
    const denied=await handler(new Request(ORIGIN+'/?action=lead-experience&leadId=a',{headers:{Origin:ORIGIN}}));
    assert.equal(denied.status,401);assert.equal(calls.length,0);
    const missing=await handler(request(ORIGIN+'/?action=lead-experience&leadId=a'));
    assert.equal(missing.status,404);assert.equal(calls.length,1);
    assert.equal((await handler(request(ORIGIN+'/?action=lead-experience'))).status,400);
  }finally{restore(previous)}
});

test('history associates exact customer and unique unassigned phone, without another customer or attendance', async () => {
  const previous={fetch:globalThis.fetch,env:envSnapshot()};setup();const calls=[];
  globalThis.fetch=async url=>{
    const path=String(url);calls.push(path);
    if(path.includes('/crm_app_state'))return Response.json([{data:{leads:[{id:'lead-a',phone:'+55 (15) 99760-1234'}],attendances:[{id:'attendance-a',leadId:'lead-a'}]}}]);
    if(path.includes('/crm_automation_queue'))return Response.json([{id:QUEUE_ID,status:'awaiting_operator'}]);
    if(path.includes('customer_id=eq.'))return Response.json([{id:'a',customer_id:'lead-a',status:'recovery_in_progress',recovery_queue_id:QUEUE_ID,created_at:'2026-10-17'}]);
    return Response.json([{id:'b',customer_id:null,source_type:'homologation',created_at:'2026-10-16'}, {id:'c',customer_id:'other'}, {id:'d',source_type:'attendance',source_id:'other-attendance'}]);
  };
  try{
    const response=await handler(request(ORIGIN+'/?action=lead-experience&leadId=lead-a'));assert.equal(response.status,200);
    const data=await response.json();assert.deepEqual(data.items.map(x=>x.id),['a','b']);assert.equal(data.items[0].recovery_queue_status,'awaiting_operator');
    assert.equal('customer_id' in data.items[0],false);assert.equal(data.phoneAssociationAmbiguous,false);
    assert.ok(calls.some(x=>x.includes('recipient_phone=eq.5515997601234&customer_id=is.null')));
    assert.ok(calls.every(x=>x.startsWith(CRM_DB_URL+'/rest/v1/')));
  }finally{restore(previous)}
});

test('shared phones do not attach unassigned survey history to either lead', async () => {
  const previous={fetch:globalThis.fetch,env:envSnapshot()};setup();const calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return String(url).includes('/crm_app_state')?Response.json([{data:{leads:[{id:'a',phone:'5515997601234'},{id:'b',phone:'+55 15 99760-1234'}]}}]):Response.json([])};
  try{
    const data=await (await handler(request(ORIGIN+'/?action=lead-experience&leadId=a'))).json();
    assert.equal(data.phoneAssociationAmbiguous,true);assert.deepEqual(data.items,[]);assert.equal(calls.some(x=>x.includes('recipient_phone=')),false);
  }finally{restore(previous)}
});

test('direct recovery link only fetches the requested awaiting-operator case', async () => {
  const previous={fetch:globalThis.fetch,env:envSnapshot()};setup();const calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json([])};
  try{
    const response=await handler(request(ORIGIN+'/?action=automation-queue&queueId='+QUEUE_ID));assert.equal(response.status,200);
    assert.match(calls[0],/status=eq.awaiting_operator/);assert.ok(calls[0].includes('&id=eq.'+QUEUE_ID));
    const invalid=await handler(request(ORIGIN+'/?action=automation-queue&queueId=invalid'));assert.equal(invalid.status,400);assert.equal(calls.length,1);
  }finally{restore(previous)}
});

test('lead history rendering escapes notes and keeps result actions limited to open recoveries', async () => {
  const {readFile}=await import('node:fs/promises');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const code=html.slice(html.indexOf('function experienceHistoryHtml('),html.indexOf('async function loadLeadExperience('));
  const render=new Function('esc',code+';return experienceHistoryHtml;')(value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const output=render([{service_name:'Teste',status:'recovery_in_progress',satisfaction:'needs_improvement',recovery_note:'<script>alert(1)</script>',recovery_queue_id:QUEUE_ID,recovery_queue_status:'awaiting_operator'}]);
  assert.match(output,/Poderia melhorar/);assert.match(output,/Registrar atendimento da recuperação/);assert.ok(output.includes('/followups?case='+QUEUE_ID));assert.doesNotMatch(output,/<script>/);
  assert.doesNotMatch(render([{recovery_queue_id:QUEUE_ID,recovery_queue_status:'completed'}]),/Registrar atendimento/);
  assert.match(render([]),/Nenhuma pesquisa/);
});


