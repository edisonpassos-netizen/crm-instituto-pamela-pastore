import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture(file,responses){
 const html=readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const elements=new Map();
 function element(){return {textContent:'',innerHTML:'',disabled:false,value:'',className:'',children:[],classList:{add(){},remove(){}},addEventListener(){},replaceChildren(...children){this.children=children;this.innerHTML=''},append(...children){this.children.push(...children)}}}
 const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:element};
 const context=vm.createContext({document,Date,console,URLSearchParams,fetch:async()=>{const result=responses.shift();if(result instanceof Error)throw result;return Response.json(result?.body??{}, {status:result?.status??200})}});
 const source=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/(?:boot|load)\(\);\s*$/,'');
 vm.runInContext(source,context);
 return {elements,run:source=>vm.runInContext(source,context)};
}
test('operations refresh clears stale figures and restores login when session expires',async()=>{
 const f=fixture('operacao.html',[{status:401,body:{error:'Sessão expirada'}}]);
 f.elements.get('kpis')??f.run("$('kpis')");f.elements.get('kpis').innerHTML='dados antigos';
 await f.run("load().catch(showLoadError)");
 assert.equal(f.elements.get('kpis').innerHTML,'');assert.equal(f.elements.get('refresh').disabled,false);assert.match(f.elements.get('loginError').textContent,/expirou/);
});
test('operations boot distinguishes data failure from invalid authentication',async()=>{
 const f=fixture('operacao.html',[{body:{authenticated:true}},{status:503,body:{error:'Falha no banco'}},{body:{data:{}}},{body:{items:[]}}]);
 await f.run('boot()');assert.equal(f.elements.get('health').textContent,'Falha na atualização');assert.match(f.elements.get('updated').textContent,/Dados não atualizados/);assert.equal(f.elements.get('refresh').disabled,false);
});
test('conversation refresh removes old messages when the request fails',async()=>{
 const f=fixture('conversas.html',[new Error('Sem conexão')]);
 await f.run('load()');assert.match(f.elements.get('status').textContent,/não concluída/);assert.equal(f.elements.get('messages').children.length,0);assert.equal(f.elements.get('refresh').disabled,false);
});
