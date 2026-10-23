// Test-only bridge: real application handlers -> local PostgREST -> ephemeral PostgreSQL.
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

const root = process.cwd();
const origin = 'https://localhost:8443';
const secret = 'ephemeral-jwt-signing-key-for-crm-e2e-only';
const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
const tokenBody = `${encode({alg:'HS256',typ:'JWT'})}.${encode({role:'service_role',ref:'dxfzuxybubvnjertiowf',exp:Math.floor(Date.now()/1000)+3600})}`;
const token = `${tokenBody}.${createHmac('sha256',secret).update(tokenBody).digest('base64url')}`;
// Override every potentially inherited application credential with synthetic values.
Object.assign(process.env, {
  CRM_ALLOWED_ORIGIN: origin, CRM_LOGIN_PASSWORD: 'synthetic-e2e-password',
  CRM_SESSION_SECRET: 'synthetic-e2e-session-secret-at-least-32',
  SUPABASE_URL: 'https://dxfzuxybubvnjertiowf.supabase.co', SUPABASE_SERVICE_ROLE_KEY: token,
  AUTOMATIONS_ENABLED: 'false', INTERNAL_AUTOMATIONS_ENABLED: 'false',
  CUSTOMER_EXPERIENCE_ENABLED: 'false', WHATSAPP_TEST_MODE: 'false',
  WHATSAPP_PRODUCTION_ENABLED: 'false', WHATSAPP_OUTBOUND_MODE: 'disabled',
  WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: '', WHATSAPP_PHONE_NUMBER_ID: ''
});
const networkFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (url.origin !== 'https://dxfzuxybubvnjertiowf.supabase.co' || !url.pathname.startsWith('/rest/v1/')) {
    throw new Error('E2E outbound destination blocked');
  }
  return networkFetch(`http://127.0.0.1:3000/${url.pathname.slice('/rest/v1/'.length)}${url.search}`, options);
};
const { default: handler } = await import('../../netlify/functions/crm-state.mjs');
const { default: worker } = await import('../../netlify/functions/automation-worker.mjs');
const pages = new Map([['/conversas.html','conversas.html'],['/','index.html'],['/followups','followups-operacionais.html'],['/atendimentos','atendimentos-operacionais.html'],['/operacao','operacao.html']]);
const server = https.createServer({key:await readFile('/tmp/crm-e2e-key.pem'),cert:await readFile('/tmp/crm-e2e-cert.pem')},async(req,res)=>{
  try {
    const url = new URL(req.url,origin);
    if (url.pathname === '/.netlify/functions/crm-state') {
      const chunks=[];for await(const c of req)chunks.push(c);
      const body=Buffer.concat(chunks);
      const response=await handler(new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}: {})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(url.pathname==='/__qa/worker'&&req.method==='POST'){
      process.env.INTERNAL_AUTOMATIONS_ENABLED='true';
      try { const response=await worker();res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer())); }
      finally { process.env.INTERNAL_AUTOMATIONS_ENABLED='false'; }
      return;
    }
    const file=pages.get(url.pathname);
    if(!file){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(resolve(root,file)));
  } catch(error) { console.error('E2E handler error:',error.message);res.writeHead(500);res.end('Synthetic server failure'); }
});
server.listen(8443,'127.0.0.1',()=>console.log('E2E application ready'));
