import { chromium } from '/tmp/crm-qa/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const origin='https://localhost:8443';
const endpoint='/.netlify/functions/crm-state';
const browser=await chromium.launch({headless:true});
let passed=0;
const sql=q=>execFileSync('psql',['-X','-t','-A','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();
async function check(name,fn){await fn();passed++;console.log(`PASS E2E ${passed}: ${name}`);}
async function context(viewport={width:1366,height:900}){
 const c=await browser.newContext({ignoreHTTPSErrors:true,viewport});
 await c.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 return c;
}
async function login(page){
 await page.goto(origin);await page.locator('#authGate').waitFor({state:'visible'});
 await page.locator('#authPassword').fill('synthetic-e2e-password');await page.locator('#authSubmit').click();
 await page.locator('#authGate').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('#dbStatus').textContent.includes('dados na nuvem'));
}
async function cloud(page,method='GET',body){return page.evaluate(async({endpoint,method,body})=>{
 const r=await fetch(endpoint,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
},{endpoint,method,body});}
let c;
try{
 c=await context();const page=await c.newPage();
 await check('invalid login is rejected without state mutation',async()=>{
  await page.goto(origin);await page.locator('#authPassword').fill('invalid-synthetic');await page.locator('#authSubmit').click();
  await page.getByText('Senha incorreta.',{exact:true}).waitFor();assert.equal(sql('select count(*) from crm_app_state'), '1');
 });
 await check('valid login uses secure HttpOnly session cookie',async()=>{
  await page.locator('#authPassword').fill('synthetic-e2e-password');await page.locator('#authSubmit').click();
  await page.locator('#authGate').waitFor({state:'hidden'});
  const cookie=(await c.cookies()).find(x=>x.name==='crm_session');assert.ok(cookie.httpOnly&&cookie.secure&&cookie.sameSite==='Strict');
 });
 await check('create lead through UI writes physical PostgreSQL state',async()=>{
  await page.getByRole('button',{name:'👥 Leads',exact:true}).click();await page.getByRole('button',{name:'➕ Novo lead',exact:true}).click();
  await page.locator('#leadForm [name=name]').fill('QA Synthetic Lead');await page.locator('#leadForm [name=phone]').fill('00000000000');
  await page.getByRole('button',{name:'Salvar lead',exact:true}).click();await page.locator('#modalBack').waitFor({state:'hidden'});
  assert.equal(sql("select count(*) from crm_app_state, jsonb_array_elements(data->'leads') l where l->>'name'='QA Synthetic Lead'"),'1');
 });
 await check('reload, search and edit preserve lead',async()=>{
  await page.reload();await page.locator('#search').fill('QA Synthetic Lead');await page.getByRole('button',{name:'Abrir',exact:true}).click();
  await page.locator('#leadForm [name=name]').fill('QA Edited Lead');await page.getByRole('button',{name:'Salvar lead',exact:true}).click();
  await page.locator('#modalBack').waitFor({state:'hidden'});assert.equal(sql("select data->'leads'->0->>'name' from crm_app_state"),'QA Edited Lead');
 });
 await check('follow-up UI creates atomic queue entry and completes task',async()=>{
  await page.getByRole('button',{name:'📅 Follow-ups',exact:true}).click();await page.getByRole('button',{name:'➕ Novo follow-up',exact:true}).click();
  await page.locator('#taskForm [name=note]').fill('Synthetic follow-up');await page.locator('#taskForm button').click();
  await page.locator('#modalBack').waitFor({state:'hidden'});
  assert.equal(sql("select jsonb_array_length(data->'tasks') from crm_app_state"),'1');
  assert.equal(sql("select count(*) from crm_automation_queue where source_type='task' and source_id=(select data->'tasks'->0->>'id' from crm_app_state)"),'1');
  await page.getByRole('button',{name:'Concluir',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await fetch('/.netlify/functions/crm-state');return (await r.json()).data.tasks[0].done===true;});
 });
 await check('new browser authentication reads committed data',async()=>{
  const fresh=await context();const p=await fresh.newPage();await login(p);
  const r=await cloud(p);assert.equal(r.data.data.leads[0].name,'QA Edited Lead');assert.equal(r.data.data.tasks[0].done,true);await fresh.close();
 });
 await check('attendance UI records completion without consent and without survey queue',async()=>{
  await page.goto(origin+'/atendimentos');await page.locator('#app').waitFor({state:'visible'});
  await page.locator('#attendanceNote').fill('Synthetic attendance');await page.locator('#createAttendance').click();
  await page.getByText('Atendimento registrado.',{exact:true}).waitFor();
  await page.locator('[data-complete]').click();await page.locator('#completeNote').fill('Synthetic completion without consent');
  await page.locator('#confirmComplete').click();await page.locator('#completeBack').waitFor({state:'hidden'});
  assert.equal(sql("select data->'attendances'->0->>'status' from crm_app_state"),'Concluído');
  assert.equal(sql("select data->'attendances'->0->>'experienceConsent' from crm_app_state"),'false');
  assert.equal(sql("select count(*) from crm_customer_experience where source_type='attendance' and source_id=(select data->'attendances'->0->>'id' from crm_app_state)"),'0');
 });
 await check('operator queue UI reschedules a task atomically',async()=>{
  // Run the real worker against local PostgREST; every external destination remains blocked.
  const base=await cloud(page);const id=crypto.randomUUID();
  base.data.data.tasks.push({id,leadId:base.data.data.leads[0].id,date:'2026-10-19',time:'09:00',type:'Retorno',done:false,note:'QA operator fixture'});
  assert.equal((await cloud(page,'PUT',{data:base.data.data,revision:base.data.revision})).status,200);
  const workerStatuses=await page.evaluate(async()=>Promise.all([1,2].map(async()=>{const r=await fetch('/__qa/worker',{method:'POST'});return r.status;})));
  assert.deepEqual(workerStatuses,[200,200]);
  assert.equal(sql("select attempts from crm_automation_queue where source_type='task' and source_id='"+id+"'"),'1');
  const queue=sql("select id from crm_automation_queue where source_type='task' and source_id='"+id+"'");
  await page.goto(origin+'/followups?case='+queue);await page.locator('[data-id=\"'+queue+'\"]').click();
  await page.locator('#outcome').selectOption('rescheduled');await page.locator('#rescheduleDate').fill('2099-01-02');
  await page.locator('#rescheduleTime').fill('15:30');await page.locator('#note').fill('Synthetic reschedule');await page.locator('#saveResult').click();
  await page.locator('#modalBack').waitFor({state:'hidden'});
  assert.equal(sql("select count(*) from crm_app_state,jsonb_array_elements(data->'tasks') t where t->>'date'='2099-01-02' and t->>'time'='15:30'"),'1');
  assert.equal(sql("select status from crm_automation_queue where id='"+queue+"'"),'completed');
 });
 await check('survey first response survives conflict and recovery closes through operator UI',async()=>{
  const lead=sql("select data->'leads'->0->>'id' from crm_app_state");
  const experience=sql("select register_customer_experience_request('homologation','qa-ui-recovery','"+lead+"','00000000000','QA','Pilates','{}')");
  sql("update crm_customer_experience set status='awaiting_response',requested_at=now(),request_provider_message_id='qa-ui-request' where id='"+experience+"'");
  sql("select record_customer_experience_response('qa-ui-response','00000000000','qa-ui-request','needs_improvement','Poderia melhorar')");
  sql("select record_customer_experience_response('qa-ui-response-second','00000000000','qa-ui-request','very_good','Excelente')");
  assert.equal(sql("select satisfaction from crm_customer_experience where id='"+experience+"'"),'needs_improvement');
  await page.evaluate(()=>fetch('/__qa/worker',{method:'POST'}));
  const queue=sql("select recovery_queue_id from crm_customer_experience where id='"+experience+"'");
  await page.goto(origin+'/followups?case='+queue);await page.locator('#modalBack').waitFor({state:'visible'});
  await page.locator('#outcome').selectOption('resolved');await page.locator('#note').fill('Synthetic recovery completed');
  await page.locator('#saveResult').click();await page.locator('#modalBack').waitFor({state:'hidden'});
  assert.equal(sql("select status from crm_customer_experience where id='"+experience+"'"),'review_pending');
  assert.equal(sql("select count(*) from crm_automation_queue where source_id='"+experience+"' and event_type='review_invitation' and status='pending'"),'1');
 });
 await check('two concurrent operators receive one success and one revision conflict',async()=>{
  const base=await cloud(page);const payload={data:base.data.data,revision:base.data.revision};
  const results=await Promise.all([cloud(page,'PUT',payload),cloud(page,'PUT',payload)]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal((await cloud(page,'PUT',payload)).status,409);
 });
 await check('invalid payload and full erasure cannot overwrite data',async()=>{
  assert.equal((await cloud(page,'PUT',{data:[],revision:1})).status,400);
  const base=await cloud(page);assert.equal((await cloud(page,'PUT',{data:{leads:[],tasks:[],sales:[]},revision:base.data.revision})).status,409);
 });
 await check('offline UI warns instead of claiming cloud persistence; database remains unchanged',async()=>{
  // Reload after API concurrency tests so UI revision is current.
  await page.goto(origin);await page.getByRole('button',{name:'👥 Leads',exact:true}).click();
  const before=sql('select revision from crm_app_state');await c.setOffline(true);
  await page.getByRole('button',{name:'➕ Novo lead',exact:true}).click();await page.locator('#leadForm [name=name]').fill('QA Offline Only');
  await page.locator('#leadForm [name=phone]').fill('00000000000');await page.getByRole('button',{name:'Salvar lead',exact:true}).click();
  await page.locator('#toast').filter({hasText:'somente neste navegador'}).waitFor();assert.equal(sql('select revision from crm_app_state'),before);
  await c.setOffline(false);await page.reload();await page.waitForFunction(()=>document.querySelector('#dbStatus').textContent.includes('dados na nuvem'));
  assert.equal(sql("select count(*) from crm_app_state,jsonb_array_elements(data->'leads') l where l->>'name'='QA Offline Only'"),'0');
 });
 await check('lost save response preserves one committed record without duplicate retry',async()=>{
  await page.getByRole('button',{name:'👥 Leads',exact:true}).click();
  await page.evaluate(()=>saveQueue);
  let lost=false;
  const intercept=async route=>{
   if(route.request().method()==='PUT'&&!lost){lost=true;await route.fetch();await route.abort('connectionfailed');}
   else await route.continue();
  };
  await c.route('**/.netlify/functions/crm-state',intercept);
  await page.getByRole('button',{name:'➕ Novo lead',exact:true}).click();
  await page.locator('#leadForm [name=name]').fill('QA Response Lost');await page.locator('#leadForm [name=phone]').fill('00000000000');
  await page.getByRole('button',{name:'Salvar lead',exact:true}).click();
  await page.locator('#toast').filter({hasText:'somente neste navegador'}).waitFor();
  await c.unroute('**/.netlify/functions/crm-state',intercept);
  assert.equal(sql("select count(*) from crm_app_state,jsonb_array_elements(data->'leads') l where l->>'name'='QA Response Lost'"),'1');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#dbStatus').textContent.includes('dados na nuvem'));
  assert.equal((await cloud(page)).data.data.leads.filter(x=>x.name==='QA Response Lost').length,1);
 });
 await check('WhatsApp inbox uses authenticated backend and renders untrusted text safely',async()=>{
  sql("select public.ingest_crm_lead_message('e2e-inbox-synthetic','888888','5515999990001','QA Inbox','text','<img src=x onerror=alert(1)> Quero Pilates',now(),'{}')");
  await page.goto(origin+'/conversas.html');
  await page.locator('#messages article').waitFor();
  assert.ok((await page.locator('#messages').innerText()).includes('<img src=x onerror=alert(1)>'));
  assert.equal(await page.locator('#messages img').count(),0);
  await page.locator('#phone').fill('5515999990001');await page.locator('#refresh').click();
  await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#messages article').count(),1);
  await page.locator('#phone').fill('123');await page.locator('#refresh').click();
  await page.locator('#error').filter({hasText:'país e DDD'}).waitFor();
  await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('#dbStatus').textContent.includes('dados na nuvem'));
 });
 await check('logout rejects subsequent authenticated reads',async()=>{
  assert.equal((await page.evaluate(async()=>{const r=await fetch('/.netlify/functions/crm-state?action=logout',{method:'POST'});return r.status;})),200);
  assert.equal((await cloud(page)).status,401);
 });
 await check('malformed and expired cookies fail closed',async()=>{
  await c.addCookies([{name:'crm_session',value:'%',url:origin,secure:true}]);assert.equal((await cloud(page)).status,401);
  const body=Buffer.from(JSON.stringify({exp:1,nonce:'synthetic'})).toString('base64url');
  const signature=createHmac('sha256','synthetic-e2e-session-secret-at-least-32').update(body).digest('base64url');
  await c.addCookies([{name:'crm_session',value:`${body}.${signature}`,url:origin,secure:true}]);assert.equal((await cloud(page)).status,401);
 });
 await check('mobile login and lead form fit viewport',async()=>{
  const mobile=await context({width:390,height:844});const p=await mobile.newPage();await login(p);
  await p.getByRole('button',{name:'👥 Leads',exact:true}).click();await p.getByRole('button',{name:'➕ Novo lead',exact:true}).click();
  const box=await p.locator('#modal').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);await mobile.close();
 });
 console.log(`E2E_RESULT passed=${passed} failed=0`);
}finally{await browser.close();}
