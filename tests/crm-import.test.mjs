import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture(leads=[]){
  const state={leads:structuredClone(leads)}, message={innerHTML:''};
  const context=vm.createContext({state,Date,console,saveStore:async()=>{},toast:()=>{},esc:String,id:()=>String(state.leads.length+1),document:{getElementById:()=>message}});
  vm.runInContext(html.slice(html.indexOf('function normalizeKey('),html.indexOf('function u16(')),context);
  return {context,state,message,run:source=>vm.runInContext(source,context)};
}
test('import retains a completed sale and attendance instead of resetting flags',async()=>{
  const f=fixture();await f.run('mergeRows([{Nome:"Ana",Telefone:"15999990001","Foi na Aula?":"Sim","Fechou plano?":"Sim"}])');
  assert.equal(f.state.leads[0].bought,true);assert.equal(f.state.leads[0].attended,true);assert.equal(f.state.leads[0].status,'Venda realizada');
});
test('equal names with different phones remain separate people',async()=>{
  const f=fixture([{id:'a',name:'Ana',phone:'15999990001',notes:'Preservar'}]);
  await f.run('mergeRows([{Nome:"Ana",Telefone:"15999990002"}])');
  assert.equal(f.state.leads.length,2);assert.equal(f.state.leads[0].phone,'15999990001');assert.equal(f.state.leads[0].notes,'Preservar');
});
test('Brazilian local and international phone formats match without clearing missing fields',async()=>{
  const f=fixture([{id:'a',name:'Ana',phone:'5515999990001',notes:'Histórico',bought:true,status:'Venda realizada',service:'Pilates',email:'ana@example.invalid'}]);
  await f.run('mergeRows([{Nome:"Ana atualizada",Telefone:"(15) 99999-0001"}])');
  assert.equal(f.state.leads.length,1);assert.equal(f.state.leads[0].name,'Ana atualizada');assert.equal(f.state.leads[0].bought,true);assert.equal(f.state.leads[0].status,'Venda realizada');assert.equal(f.state.leads[0].notes,'Histórico');assert.equal(f.state.leads[0].service,'Pilates');assert.equal(f.state.leads[0].email,'ana@example.invalid');
});
test('CSV accepts Excel semicolons, multiline notes and escaped quotes',()=>{
  const f=fixture();f.context.input='\uFEFFNome;Telefone;Comentários\r\nAna;15999990001;"Primeira linha\r\nSegunda; com ""aspas"""\r\n';
  const rows=f.run('parseCSV(input)');assert.equal(rows.length,1);assert.equal(rows[0].Nome,'Ana');assert.equal(rows[0]['Comentários'],'Primeira linha\r\nSegunda; com "aspas"');
});
test('CSV comma remains supported and unfinished quotes are rejected',()=>{
  const f=fixture();assert.equal(f.run('parseCSV("Nome,Telefone\\nAna,15999990001")[0].Nome'),'Ana');assert.throws(()=>f.run('parseCSV(\'Nome,Telefone\\n"Ana,15999990001\')'));
});
test('ambiguous existing phone matches do not overwrite either contact',async()=>{
  const f=fixture([{id:'a',name:'Ana',phone:'15999990001'},{id:'b',name:'Bia',phone:'5515999990001'}]);
  await f.run('mergeRows([{Nome:"Outro",Telefone:"15999990001"}])');
  assert.equal(f.state.leads.length,2);assert.equal(f.state.leads[0].name,'Ana');assert.equal(f.state.leads[1].name,'Bia');assert.match(f.message.innerHTML,/1.*amb/);
});
test('recognized lead_status is kept and malformed phone rows are skipped',async()=>{
  const f=fixture();await f.run('mergeRows([{Nome:"Ana",Telefone:"15999990001",lead_status:"Agendado"},{Nome:"Inválido",Telefone:"123"}])');
  assert.equal(f.state.leads.length,1);assert.equal(f.state.leads[0].status,'Agendado');assert.match(f.message.innerHTML,/1.*inv/);
});
test('blank XLSX phone column remains supported without mistaking another named field for phone',()=>{
  const f=fixture();assert.equal(f.run('mapRow({Nome:"Ana",__blank_D:"15999990001"}).phone'),'15999990001');assert.equal(f.run('mapRow({Nome:"Ana",Comentários:"15999990001"}).phone'),undefined);
});
test('explicit negative answers update flags and repeated import does not duplicate a phone',async()=>{
  const f=fixture([{id:'a',name:'Ana',phone:'15999990001',attended:true,bought:true}]);
  await f.run('mergeRows([{Nome:"Ana",Telefone:"15999990001","Foi na Aula?":"Não","Fechou plano?":"Não"}])');
  assert.equal(f.state.leads[0].bought,false);assert.equal(f.state.leads[0].attended,false);
  await f.run('mergeRows([{Nome:"Ana",Telefone:"+55 (15) 99999-0001"}])');assert.equal(f.state.leads.length,1);
});
test('CSV rejects duplicate headers and extra columns before any records are changed',()=>{
  const f=fixture();assert.throws(()=>f.run('parseCSV("Nome,Nome\\nAna,Bia")'));assert.throws(()=>f.run('parseCSV("Nome,Telefone\\nAna,15999990001,excesso")'));assert.equal(f.state.leads.length,0);
});
