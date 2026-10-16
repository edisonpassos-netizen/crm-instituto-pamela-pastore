import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/crm-state.mjs';
import { __test as workerTest } from '../netlify/functions/automation-worker.mjs';
import { __test as webhookTest } from '../netlify/functions/whatsapp-status-webhook.mjs';
import { crmDatabaseConfig, CRM_DATABASE_URL } from '../netlify/functions/lib/crm-database.mjs';

const origin='https://peppy-salamander-2d8776.netlify.app';
const jwt=claims=>`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
test('configuration rejects the Agenda URL and all other projects',()=>{
  for(const url of ['https://pposribyzhxyupbxrpfo.supabase.co','https://other.supabase.co','',CRM_DATABASE_URL+'.example.com']){
    assert.throws(()=>crmDatabaseConfig({SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic'}),/exclusivo/);
  }
});
test('configuration accepts only server credentials for the CRM project',()=>{
  assert.throws(()=>crmDatabaseConfig({SUPABASE_URL:CRM_DATABASE_URL,SUPABASE_SERVICE_ROLE_KEY:'sb_publishable_synthetic'}),/secreta/);
  for(const key of ['',jwt({ref:'pposribyzhxyupbxrpfo',role:'service_role'}),jwt({ref:'dxfzuxybubvnjertiowf',role:'anon'}),'invalid']){
    assert.throws(()=>crmDatabaseConfig({SUPABASE_URL:CRM_DATABASE_URL,SUPABASE_SERVICE_ROLE_KEY:key}));
  }
  assert.equal(crmDatabaseConfig({SUPABASE_URL:CRM_DATABASE_URL+'/',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic'}).url,CRM_DATABASE_URL);
  assert.equal(crmDatabaseConfig({SUPABASE_URL:CRM_DATABASE_URL,SUPABASE_SERVICE_ROLE_KEY:jwt({ref:'dxfzuxybubvnjertiowf',role:'service_role'})}).url,CRM_DATABASE_URL);
});

test('worker and WhatsApp webhook inherit the same exclusive CRM database guard',()=>{
  const savedUrl=process.env.SUPABASE_URL,savedKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{
    process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_synthetic';
    process.env.SUPABASE_URL='https://pposribyzhxyupbxrpfo.supabase.co';
    assert.throws(()=>workerTest.supabaseConfig(),/exclusivo/);
    assert.throws(()=>webhookTest.config(),/exclusivo/);
    process.env.SUPABASE_URL=CRM_DATABASE_URL;
    assert.equal(workerTest.supabaseConfig().base,CRM_DATABASE_URL);
    assert.equal(webhookTest.config().url,CRM_DATABASE_URL);
  }finally{
    if(savedUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=savedUrl;
    if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;
  }
});

test('readiness checks the real request path and exposes no customer data',async()=>{
  const originalUrl=process.env.SUPABASE_URL,originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY,originalFetch=globalThis.fetch;
  process.env.SUPABASE_URL=CRM_DATABASE_URL;process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_synthetic';
  const request=new Request(origin+'/.netlify/functions/crm-state?action=health');
  try{
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),CRM_DATABASE_URL+'/rest/v1/crm_app_state?id=eq.main&select=id');assert.equal(options.method,'GET');
      return Response.json([{id:'main',data:{private:'must not be returned'}}]);
    };
    let response=await handler(request);assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,databaseProjectRef:'dxfzuxybubvnjertiowf'});
    globalThis.fetch=async()=>Response.json({error:'synthetic unauthorized'},{status:401});
    response=await handler(request);assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
    globalThis.fetch=async()=>Response.json([]);response=await handler(request);assert.equal(response.status,503);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalUrl;
    if(originalKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
  }
});

test('authenticated handler uses only the CRM project and preserves CAS behavior',async()=>{
  const savedEnv={...process.env},savedFetch=globalThis.fetch;
  const calls=[];
  process.env.CRM_LOGIN_PASSWORD='synthetic-password-for-tests';
  process.env.CRM_SESSION_SECRET='synthetic-session-secret-of-more-than-32-characters';
  process.env.SUPABASE_URL=CRM_DATABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_synthetic';
  const request=(method,action='',body,cookie)=>new Request(origin+'/.netlify/functions/crm-state'+(action?'?action='+action:''),{
    method,headers:{Origin:origin,...(cookie?{cookie}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})
  });
  try{
    let reply=await handler(request('POST','login',{password:process.env.CRM_LOGIN_PASSWORD}));
    assert.equal(reply.status,200);const cookie=reply.headers.get('set-cookie').split(';')[0];
    globalThis.fetch=async(url,options)=>{
      calls.push({url:String(url),options});
      return Response.json(options.method==='GET'?[{data:{leads:[]},revision:15,updated_at:'2026-10-15T00:00:00Z'}]:[{revision:16,updated_at:'2026-10-15T00:00:01Z'}]);
    };
    reply=await handler(request('GET','',null,cookie));assert.equal(reply.status,200);assert.equal((await reply.json()).revision,15);
    reply=await handler(request('PUT','',{data:{leads:[]},revision:15},cookie));assert.equal(reply.status,200);
    assert.ok(calls.every(c=>c.url.startsWith(CRM_DATABASE_URL+'/rest/v1/crm_app_state')));
    assert.equal(calls[1].options.method,'GET');assert.match(calls[1].url,/select=data,revision/);
    assert.equal(calls[2].options.method,'PATCH');assert.match(calls[2].url,/revision=eq\.15/);assert.equal(JSON.parse(calls[2].options.body).revision,16);
    assert.equal(calls[0].options.headers.apikey,'sb_secret_synthetic');assert.equal(calls[0].options.headers.Authorization,undefined);
    let before=calls.length;process.env.SUPABASE_URL='https://pposribyzhxyupbxrpfo.supabase.co';
    reply=await handler(request('GET','',null,cookie));assert.equal(reply.status,503);assert.equal(calls.length,before);
    process.env.SUPABASE_URL=CRM_DATABASE_URL;
    globalThis.fetch=async()=>Response.json([{data:{leads:[]},revision:16}]);
    reply=await handler(request('PUT','',{data:{leads:[]},revision:15},cookie));assert.equal(reply.status,409);
    reply=await handler(request('GET'));assert.equal(reply.status,401);
  }finally{
    globalThis.fetch=savedFetch;
    for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];
    Object.assign(process.env,savedEnv);
  }
});