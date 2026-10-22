# Continuidade da homologação — 19/10/2026

Este documento complementa HOMOLOGACAO-CRM-20261019.md e preserva os resultados anteriores. Nenhum merge ou deploy de produção autorizado/executado. Dados e credenciais utilizados nos novos testes são sintéticos.

## Ponto de partida confirmado

PR #29 aberto, draft, sem merge; base main bde857a; HEAD inicial 1aae27e. Nenhuma revisão humana ou alteração de código posterior foi encontrada na leitura inicial. Produção permanece no deploy 6ad3e76baf0695dbe45abe80. As seis configurações de bloqueio continuam com os valores anteriormente registrados; são valores de configuração, não medição de memória do runtime.

## Novas evidências

A infraestrutura de teste agora usa Chromium em GitHub Actions, o handler real crm-state, PostgREST 12.2.3 e PostgreSQL 17. O transporte de fetch do servidor redireciona exclusivamente a URL esperada do CRM para o PostgREST de loopback e rejeita qualquer outro destino. O navegador bloqueia recursos fora da origem local. A URL oficial não é acessada pela execução E2E: o valor é utilizado apenas para satisfazer a validação de configuração existente antes do redirecionamento local.

Não são utilizados deploy previews para testes de gravação. O certificado local e todos os segredos são sintéticos, gerados para o job efêmero. Não há dependência de segredos do GitHub/Netlify/Supabase nesses jobs.

Primeira execução: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39305707508 . Dez suítes SQL aprovadas em PostgreSQL 17, 106 testes Node aprovados; quatro cenários E2E aprovados antes de uma falha na preparação do teste: suites SQL anteriores deixaram seis tarefas fictícias e o teste esperava uma. Isso foi tratado como defeito do harness, sem presumir defeito do CRM. A correção adiciona reset protegido por current_database()='automation_test'.

A comparação inicial identificou que o workflow anterior não aplicava duas migrações já presentes no repositório: 202610150004_whatsapp_inbound_messages.sql e 20261015193500_manual_result_task_sync.sql. O workflow foi corrigido para aplicá-las no banco efêmero. Nenhuma migração foi aplicada em produção.

As diferenças de formatação e comentários em sete funções foram revistas. A comparação por tokens SQL, preservando strings e identificadores citados, não encontrou diferença de tokens nas 13 funções presentes nos dois ambientes na primeira execução. Isso verifica identidade textual normalizada, não prova equivalência de todo comportamento fora do escopo testado.

## Incidente HTTP 500

Consultas adicionais não recuperaram stack trace, corpo da resposta ou logs de inicialização. A consulta Supabase na janela 07:34–07:37 UTC encontrou uma chamada claim_due_internal_automation_jobs com status 200. Não há correlação suficiente para atribuí-la ao request que falhou. A causa raiz permanece BLOQUEADA por ausência de telemetria suficiente. NETLIFY-500-20261019.md contém uma descrição técnica preparada para suporte, não enviada.

## Resultados finais

A execução final e seus links são registrados no fechamento abaixo. As primeiras execuções foram úteis para corrigir o harness, sem modificar o código funcional do CRM.

## Comparação objetiva do schema

Snapshot de produção: production-schema-20261019.json, somente metadados/definições; nenhum registro de cliente. Resultado normalizado: schema-comparison-20261019.json.

Após incluir todas as 18 migrações existentes na CI:

| Categoria | Produção | Efêmero PostgreSQL 17 | Resultado |
|---|---:|---:|---|
| Tabelas e RLS | 5 | 5 | Correspondentes |
| Colunas | 70 | 70 | Correspondentes |
| Índices | 21 | 21 | Correspondentes |
| Funções e assinaturas/privilégios consultados | 15 | 15 | Mesmos tokens SQL, search_path, SECURITY DEFINER e EXECUTE |
| Triggers | 1 | 1 | Correspondentes |
| Constraints | 24 | 23 | Produção tem CHECK revision >= 1 adicional |
| Políticas | 5 | 6 | Efêmero tem política deny-all adicional em crm_app_state |
| Grants de tabela consultados | 35 | 15 | service_role tem 20 grants adicionais em produção |

As diferenças de grants são restritas ao service_role. Nenhuma permissão direta para anon/authenticated foi encontrada na captura. A política adicional deny-all não concede acesso. Não se ampliaram privilégios do banco de teste para imitar concessões mais abrangentes, nem se alterou a produção. O API já rejeita revisões inferiores a 1; a constraint adicional de produção fortalece essa regra. Não foi criada migração especulativa para remover uma proteção existente. Paridade estrutural absoluta não é declarada.

## Controles do harness

O reset de fixtures verifica o nome automation_test antes de TRUNCATE/UPDATE e só é chamado pelo job com PostgreSQL de serviço. É um script destrutivo exclusivamente para dados sintéticos descartáveis, não uma migração de produção. Os cenários de worker chamam o handler real através de uma rota de teste existente somente no servidor local, com modo externo desabilitado e destinos externos rejeitados. O servidor de teste não faz parte das funções de produção.

Concorrência é exercitada em dois processos psql com transações independentes e locks sobrepostos, validando ids distintos, uma única tentativa por job, preservação do job externo e recuperação de lock expirado. Os testes E2E usam queries SQL de verificação e fixtures, não um banco em memória.

## Alcance e rollback

Nenhuma alteração nova no código funcional do CRM foi necessária nesta continuação até a revisão das execuções; as mudanças ampliam o harness/CI e documentação. O defeito de cookie já corrigido no PR #29 permanece a única mudança funcional proposta desde a auditoria inicial.

Rollback do conjunto: reverter os commits do PR; não há migração ou mudança de dados de produção a desfazer. Uma eventual publicação exige revisão do diff, aprovação específica e uso do deploy anterior conhecido como opção de reversão. Esta execução não solicita nem realiza publicação.

## Ajustes do harness durante a execução

- A primeira tentativa foi interrompida pela contagem de tarefas herdadas das suites SQL; o reset das fixtures foi adicionado depois das suites.
- A execução intermediária concluiu os 14 cenários então existentes com sucesso, em https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39306085478 .
- A ampliação para recuperação encontrou timeout ao tentar clicar no botão da fila atrás de um modal que a aplicação já abre automaticamente em links de recuperação. A leitura do código e o log de interceptação do ponteiro comprovaram o erro do teste. O teste passou a aguardar o modal já aberto, preservando a aplicação.
- A execução final mantém 16 cenários, incluindo dois handlers reais de worker chamados simultaneamente e verificação de uma tentativa por job; o teste de perda de resposta deixa o backend concluir a gravação antes de simular a desconexão do navegador.

Nenhum desses ajustes foi apresentado como bug de produção. Falhas intermediárias são distintas das contagens finais e não foram omitidas.

## Limitação de operação offline comprovada

O cadastro feito sem conectividade fica no cache local e a interface avisa explicitamente que é preciso exportar backup antes de fechar. O cenário E2E verificou que ele não foi gravado no PostgreSQL e que o recarregamento volta ao estado remoto. Portanto a aprovação dos fluxos internos é para operação conectada; recuperação automática/mesclagem de alterações offline não é homologada. Não interpretar o teste de aviso offline como garantia de sincronização posterior ou ausência universal de perda de rascunhos locais.

O teste de resposta perdida é diferente: o servidor conclui a gravação no PostgreSQL antes de o navegador perder a resposta. O cenário verifica a existência de exatamente um registro após nova leitura; não simula um envio de WhatsApp.

## Fechamento da execução

Código final testado: `84972eb0d5d2f96679f68c55beaa158d6bb5c060`.

- CI integração/SQL/navegador: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39307015218 — success.
- CI sintaxe/contratos: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39307015202 — success.
- PR: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/pull/29 — atualizado, draft, sem merge.

| Indicador desta continuação | Resultado final |
|---|---:|
| Testes JavaScript descobertos/executados/aprovados | 106 / 106 / 106 |
| Testes JavaScript reprovados/ignorados | 0 / 0 |
| Suítes SQL descobertas/executadas/aprovadas | 10 / 10 / 10 |
| Suítes SQL reprovadas | 0 |
| Cenários E2E descobertos/executados/aprovados | 16 / 16 / 16 |
| Cenários E2E reprovados/ignorados na execução final | 0 / 0 |
| Teste adicional de concorrência por processos PostgreSQL | 1 aprovado |
| Migrações do repositório aplicadas ao PostgreSQL 17 efêmero | 18 |
| Novos bugs funcionais comprovados no CRM nesta continuação | 0 |
| Correções do harness/workflow | Fixtures, migrações omitidas e pré-condições de interface corrigidas e validadas |
| Correção funcional anterior preservada e retestada | Cookie malformado, no PR #29 |
| Novos PRs / PRs atualizados | 0 / 1 |

Não somar essas métricas como se fossem casos da mesma granularidade. Reexecuções não aumentam a contagem de casos. A versão do PostgreSQL registrada pelo container foi 17.11. Os 106 casos foram executados novamente nesta continuação (CI e uma execução local); a contagem não reutiliza apenas o resultado histórico.

### Os 16 cenários de navegador

1. Senha inválida rejeitada sem mutação do estado;
2. Login válido e cookie Secure/HttpOnly/SameSite=Strict;
3. Cadastro via UI com verificação física do registro no PostgreSQL;
4. Recarregamento, busca e edição com verificação no banco;
5. Follow-up criado na UI, enfileirado atomicamente e concluído;
6. Novo contexto de navegador e nova autenticação leem os dados confirmados;
7. Atendimento concluído sem consentimento, sem criar pesquisa;
8. Dois workers reais concorrentes reivindicam sem duplicar tentativas e a UI reagenda o follow-up atomicamente;
9. Primeira resposta da pesquisa preservada contra resposta conflitante; worker prepara recuperação, operador resolve e convite fica pendente sem envio;
10. Duas gravações concorrentes produzem 200/409, retry obsoleto permanece 409;
11. Payload inválido e apagamento integral rejeitados;
12. Falha offline exibe aviso e não é confundida com gravação no banco;
13. Resposta perdida após commit recupera exatamente um lead na nova leitura;
14. Logout invalida o cookie no navegador e leitura posterior recebe 401;
15. Cookie malformado e sessão expirada são rejeitados;
16. Login e formulário de lead cabem no viewport mobile de 390 x 844.

As fixtures SQL da pesquisa substituem a entrega de mensagens externas. O teste 9 não certifica envio/recebimento live pela Meta. O teste de mobile verifica o formulário de lead; não certifica todos os breakpoints de todas as páginas. Logout não certifica revogação central de uma cópia prévia do token stateless.

### Matriz por versão e escopo

| Componente | Branch proposta | Produção publicada | Alcance/pendência |
|---|---|---|---|
| Autenticação | APROVADO | REPROVADO | Cookie corrigido e regressões aprovadas na branch; correção não publicada |
| Cadastro/persistência conectada | APROVADO | NÃO TESTADO | E2E real completo em ambiente isolado; sem mutações de produção |
| Follow-ups e fila operacional | APROVADO | NÃO TESTADO | Criação, conclusão, worker e reagendamento testados |
| Banco e RPCs testados | APROVADO | APROVADO | Produção auditada em leitura; diferenças de constraint/grants documentadas, sem paridade absoluta |
| Automação interna | APROVADO | BLOQUEADO | Concorrência/lifecycle aprovados; confiabilidade do incidente de produção não concluída |
| Pesquisa/recuperação interna | APROVADO | NÃO TESTADO | SQL + UI + worker isolados; nenhum envio live |
| WhatsApp live | NÃO TESTADO | BLOQUEADO | Mocks aprovados, envio real proibido nesta execução |
| Webhooks simulados | APROVADO | NÃO TESTADO | Contratos existentes retestados; não houve evento live |
| Segurança no escopo verificado | APROVADO | REPROVADO | Limites de senha compartilhada/stateless registrados; cookie antigo ainda publicado |
| Integração navegador/backend/PostgREST/PostgreSQL | APROVADO | NÃO TESTADO | Testes de produção mantidos sem gravação |
| Interface dos cenários declarados | APROVADO | NÃO TESTADO | Não representa auditoria de todas as telas ou breakpoints |
| Recuperação de commit com resposta perdida | APROVADO | NÃO TESTADO | Sem duplicidade no cenário testado |
| Sincronização/recuperação automática offline | NÃO TESTADO | NÃO TESTADO | Não implementada/homologada; rascunho local exige backup |
| Causa raiz do HTTP 500 | BLOQUEADO | BLOQUEADO | Telemetria insuficiente; nenhum diagnóstico inventado |
| Homologação total e liberação de produção | BLOQUEADO | BLOQUEADO | Incidente em aberto, limites registrados e publicação não autorizada |

### Respostas executivas

1. **Cadastro e persistência ponta a ponta?** Sim, nos cenários conectados declarados, com navegador, handler real, PostgREST e PostgreSQL 17.11 efêmero. Não equivale a gravação de clientes reais em produção.
2. **Fluxos internos independem de WhatsApp?** Os fluxos conectados testados da branch passaram sem chamadas à Meta. Não se homologa operação offline nem confiabilidade irrestrita de produção com o incidente ainda aberto.
3. **PR #29 pronto?** Pronto para revisão técnica e decisão de publicação, com CI aprovada e rollback sem migração. Não foi feito merge, liberação ou publicação; o conjunto permanece draft.
4. **HTTP 500 explicado?** Não. Os dados disponíveis não comprovam causa raiz. Memorando para suporte preparado e não enviado.
5. **Pendências reais?** Decisão de publicação e verificação da versão publicada após autorização; investigação do 500 com telemetria adicional; homologação live do WhatsApp se/quando autorizada; eventual projeto de recuperação offline, se essa capacidade for exigida. Não prometer ausência universal de falhas fora dos testes executados.
6. **Intervenção indispensável do usuário?** Não para repetir os testes rotineiros concluídos. É necessária autorização específica para merge/publicação ou envios externos; eventual contato com suporte não foi autorizado nem realizado. Nenhuma confirmação de rotina foi solicitada.

Leitura final do CRM oficial manteve revisão 42, fila 20 e tentativas 22. As consultas não alteraram esses registros. A Agenda Pilates não foi acessada. Não foram criados recursos pagos ou projetos/branches de banco hospedados.
