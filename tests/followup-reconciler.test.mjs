import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../netlify/functions/followup-reconciler.mjs';

const CRM_TEST_URL='https://dxfzuxybubvnjertiowf.supabase.co';
const CRM_TEST_KEY='sb_secret_synthetic';

function withEnv(overrides, fn){
  const saved={...process.env};
  Object.assign(process.env,overrides);
  return Promise.resolve().then(fn).finally(()=>{
    for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
    Object.assign(process.env,saved);
  });
}

test('pendingUnqueuedTasks returns only valid open tasks missing from queue',()=>{
  const data={
    leads:[{id:'lead-1'},{id:'lead-2'}],
    tasks:[
      {id:'a',leadId:'lead-1',date:'2026-10-16',done:false},
      {id:'b',leadId:'lead-2',date:'2026-10-17',done:false},
      {id:'c',leadId:'lead-1',date:'2026-10-18',done:true},
      {id:'bad-lead',leadId:'missing',date:'2026-10-18',done:false},
      {id:'bad-date',leadId:'lead-1',date:'16/10/2026',done:false},
      {id:'',leadId:'lead-1',date:'2026-10-18',done:false}
    ]
  };
  const result=__test.pendingUnqueuedTasks(data,new Set(['b']),100);
  assert.deepEqual(result.map(x=>x.id),['a']);
});

test('queueCommand is internal only and uses the canonical dedupe key',()=>{
  const now=new Date('2026-10-16T20:00:00.000Z');
  const command=__test.queueCommand({id:'task-1'},now);
  assert.equal(command.p_dedupe_key,'crm:lead_follow_up_requested:task:task-1');
  assert.equal(command.p_event_type,'lead_follow_up_requested');
  assert.equal(command.p_source_type,'task');
  assert.equal(command.p_channel,'internal');
  assert.equal(command.p_recipient_phone,null);
  assert.equal(command.p_scheduled_at,now.toISOString());
});

test('reconciler is fail-closed when internal automations are disabled',async()=>{
  const previous=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls+=1;throw new Error('network should not be called')};
  try{
    const result=await __test.reconcileFollowUps({
      INTERNAL_AUTOMATIONS_ENABLED:'false',
      SUPABASE_URL:CRM_TEST_URL,
      SUPABASE_SERVICE_ROLE_KEY:CRM_TEST_KEY
    });
    assert.equal(result.disabled,true);
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous}
});

test('reconciler enqueues only missing valid follow-ups and never calls Meta',async()=>{
  const previous=globalThis.fetch;
  const calls=[];
  await withEnv({SUPABASE_URL:CRM_TEST_URL,SUPABASE_SERVICE_ROLE_KEY:CRM_TEST_KEY},async()=>{
    globalThis.fetch=async(url,options={})=>{
      calls.push({url:String(url),method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
      if(String(url).includes('crm_app_state'))return Response.json([{data:{
        leads:[{id:'lead-1'},{id:'lead-2'}],
        tasks:[
          {id:'task-existing',leadId:'lead-1',date:'2026-10-16',done:false},
          {id:'task-missing',leadId:'lead-2',date:'2026-10-17',done:false},
          {id:'task-done',leadId:'lead-1',date:'2026-10-18',done:true},
          {id:'task-orphan',leadId:'missing',date:'2026-10-18',done:false}
        ]
      }}]);
      if(String(url).includes('crm_automation_queue?'))return Response.json([{source_id:'task-existing'}]);
      if(String(url).includes('/rpc/enqueue_crm_automation'))return Response.json('11111111-1111-4111-8111-111111111111');
      return new Response('unexpected',{status:500});
    };
    try{
      const result=await __test.reconcileFollowUps({
        INTERNAL_AUTOMATIONS_ENABLED:'true',
        FOLLOWUP_RECONCILE_LIMIT:'100',
        SUPABASE_URL:CRM_TEST_URL,
        SUPABASE_SERVICE_ROLE_KEY:CRM_TEST_KEY
      });
      assert.equal(result.scanned,2);
      assert.equal(result.missing,1);
      assert.equal(result.enqueued,1);
      const enqueue=calls.find(call=>call.url.includes('/rpc/enqueue_crm_automation'));
      assert.equal(enqueue.body.p_source_id,'task-missing');
      assert.equal(enqueue.body.p_channel,'internal');
      assert.equal(calls.some(call=>call.url.includes('graph.facebook.com')),false);
    }finally{globalThis.fetch=previous}
  });
});
