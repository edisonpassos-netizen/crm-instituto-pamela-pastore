import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import handler from '../netlify/functions/crm-state.mjs';
const origin='https://peppy-salamander-2d8776.netlify.app';
test('inbox enforces session before database access and never returns raw message payloads',async()=>{
 const saved={fetch:globalThis.fetch,secret:process.env.CRM_SESSION_SECRET,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
 process.env.CRM_SESSION_SECRET='synthetic-session-secret-12345678901234567890';
 process.env.SUPABASE_URL='https://dxfzuxybubvnjertiowf.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_synthetic';
 let calls=0;
 globalThis.fetch=async url=>{calls++;assert.ok(!String(url).includes('message_payload'));return Response.json([{text_body:'<script>alert(1)</script>'}])};
 const payload=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+100})).toString('base64url');
 const signature=createHmac('sha256',process.env.CRM_SESSION_SECRET).update(payload).digest('base64url');
 const request=(extra='',cookie=true)=>new Request(origin+'/?action=whatsapp-messages'+extra,{headers:{Origin:origin,...(cookie?{Cookie:'crm_session='+payload+'.'+signature}:{})}});
 try{
  assert.equal((await handler(request('',false))).status,401);assert.equal(calls,0);
  assert.equal((await handler(request('&phone=1,or'))).status,400);assert.equal(calls,0);
  const response=await handler(request());assert.equal(response.status,200);assert.equal((await response.json()).items.length,1);assert.equal(calls,1);
  const filtered=await handler(request('&phone=5515999990001'));assert.equal(filtered.status,200);assert.equal(calls,2);
 }finally{globalThis.fetch=saved.fetch;for(const [k,v]of [['CRM_SESSION_SECRET',saved.secret],['SUPABASE_URL',saved.url],['SUPABASE_SERVICE_ROLE_KEY',saved.key]]){if(v===undefined)delete process.env[k];else process.env[k]=v}}
});
