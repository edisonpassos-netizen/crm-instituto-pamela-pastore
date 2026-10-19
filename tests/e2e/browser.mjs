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
  await page.reload();await page.getByRole('button',{name:'👥 Leads',exact:true}).click();
  const before=sql('select revision from crm_app_state');await c.setOffline(true);
  await page.getByRole('button',{name:'➕ Novo lead',exact:true}).click();await page.locator('#leadForm [name=name]').fill('QA Offline Only');
  await page.locator('#leadForm [name=phone]').fill('00000000000');await page.getByRole('button',{name:'Salvar lead',exact:true}).click();
  await page.locator('#toast').filter({hasText:'somente neste navegador'}).waitFor();assert.equal(sql('select revision from crm_app_state'),before);
  await c.setOffline(false);await page.reload();await page.waitForFunction(()=>document.querySelector('#dbStatus').textContent.includes('dados na nuvem'));
  assert.equal(sql("select count(*) from crm_app_state,jsonb_array_elements(data->'leads') l where l->>'name'='QA Offline Only'"),'0');
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
