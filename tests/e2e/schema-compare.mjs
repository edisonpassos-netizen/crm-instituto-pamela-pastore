import { readFileSync, writeFileSync } from 'node:fs';
const production=JSON.parse(readFileSync('audit/production-schema-20261019.json'));
const ephemeral=JSON.parse(readFileSync('/tmp/crm-ephemeral-schema.json'));
// Compare SQL tokens, preserving quoted literals; ignore formatting and comments only.
const sqlTokens=s=>(s.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+|[^\s]/g)||[]).filter(t=>!t.startsWith('--')&&!t.startsWith('/*')).join(' ');
const normalize=x=>typeof x==='string'?x.replace(/\s+/g,' ').trim():Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort().map(([k,v])=>[k,typeof v==='string'&&['definition','indexdef'].includes(k)?sqlTokens(v):normalize(v)])):x;
const keys={tables:['name'],columns:['table_name','column_name'],constraints:['table_name','name'],indexes:['tablename','indexname'],functions:['name','arguments'],triggers:['name'],policies:['tablename','policyname'],grants:['table_name','grantee','privilege_type']};
const result={};
for(const [category,fields] of Object.entries(keys)){
 const key=x=>fields.map(k=>x[k]).join('|');
 const a=new Map((production[category]||[]).map(x=>[key(x),normalize(x)]));const b=new Map((ephemeral[category]||[]).map(x=>[key(x),normalize(x)]));
 result[category]={production:a.size,ephemeral:b.size,missing:[],extra:[],different:[]};
 for(const [id,value] of a){if(!b.has(id))result[category].missing.push(id);else if(JSON.stringify(value)!==JSON.stringify(b.get(id)))result[category].different.push(id);}
 for(const id of b.keys())if(!a.has(id))result[category].extra.push(id);
}
writeFileSync('/tmp/crm-schema-diff.json',JSON.stringify(result,null,2));console.log('SCHEMA_COMPARISON',JSON.stringify(result));
