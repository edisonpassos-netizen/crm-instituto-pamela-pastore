# Homologação do CRM — Instituto Pâmela Pastore

Data da execução: 19/10/2026. Resultado: **homologação completa BLOQUEADA**. Os testes executados passaram, mas persistem limitações de E2E e investigação do incidente HTTP 500. Não há base para declarar 100% homologado.

## Escopo e rastreabilidade

- Repositório: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore
- Produção confirmada: commit `bde857a87b593221e2b89cd2de4f2b853a448bcf`, deploy Netlify `6ad3e76baf0695dbe45abe80`, estado ready.
- Correção proposta: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/pull/29 (draft, sem merge).
- Commit remoto testado: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/commit/ea89bbd18c44747c58885980b8db805e620a8009
- CI sintaxe e comportamento: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39304133506 — success.
- CI unitária e PostgreSQL: https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39304133521 — success.

O SHA do deploy corresponde ao main inspecionado; não foi feita comparação byte a byte dos bundles publicados. Todas as consultas ao banco oficial nesta sessão foram somente leitura. Não houve chamada de envio à Meta, uso do projeto de teste, alteração da Agenda Pilates, merge ou publicação.

## Indicadores desta sessão

| Indicador | Resultado |
|---|---:|
| Testes Node descobertos na versão inicial | 99 |
| Testes Node na versão final | 106 |
| Testes Node aprovados na execução final | 106 |
| Testes Node reprovados na execução final | 0 |
| Testes Node ignorados/cancelados | 0 |
| Novos testes | 7 |
| Suítes SQL executadas em PostgreSQL efêmero na CI | 10 |
| Suítes SQL aprovadas | 10 |
| Defeitos novos comprovados | 1 |
| Correções implementadas e testadas | 1 |
| PRs criados | 1 |
| Módulos JavaScript com sintaxe verificada | 35 |
| Páginas HTML com scripts verificados localmente | 4 |

As 10 suítes SQL contêm múltiplas verificações; não são contadas como 10 testes unitários nem somadas aos 106. As reexecuções locais e de CI também não são somadas como casos novos. Houve uma execução intencionalmente reprovada antes da correção: o novo teste de cookie demonstrou o defeito.

Blocos ainda bloqueados/não concluídos: E2E visual desktop/mobile; E2E navegador–API–PostgreSQL com nova autenticação; causa raiz do HTTP 500. Não existe inventário de casos individuais executáveis para esses blocos, portanto não se inventa um número de testes bloqueados. Testes live de envio WhatsApp foram excluídos pelo escopo autorizado.

## Arquitetura verificada

Frontend estático em `index.html`, `operacao.html`, `followups-operacionais.html` e `atendimentos-operacionais.html`. Não existe package.json: os testes utilizam o runner nativo do Node 24, sem instalação de dependências do aplicativo.

`crm-state` implementa login, cookie assinado por HMAC, sessão de oito horas, leitura/gravação do estado JSONB, endpoints operacionais e acesso às RPCs. O estado utiliza revisão numérica com PATCH condicionado à revisão atual; conflitos retornam 409. Existe proteção contra apagamento integral das coleções de negócio.

`followup-reconciler` roda a cada dez minutos e concilia follow-ups. `automation-worker` roda a cada cinco minutos; em modo interno usa `claim_due_internal_automation_jobs`. `whatsapp-status-webhook` verifica assinatura HMAC e processa mensagens/status. As chamadas de banco ocorrem no servidor.

O CRM exige a URL `https://dxfzuxybubvnjertiowf.supabase.co` no código e na configuração consultada. As cinco tabelas públicas são `crm_app_state`, `crm_automation_queue`, `crm_automation_attempts`, `crm_customer_experience` e `crm_whatsapp_messages`. A Agenda Pilates não foi acessada. Isso comprova a restrição de configuração do CRM; não constitui auditoria recíproca do código ou banco da Agenda.

## Configuração consultada no Netlify

| Variável | Produção |
|---|---|
| AUTOMATIONS_ENABLED | false |
| INTERNAL_AUTOMATIONS_ENABLED | true |
| CUSTOMER_EXPERIENCE_ENABLED | false |
| WHATSAPP_TEST_MODE | false |
| WHATSAPP_PRODUCTION_ENABLED | false |
| WHATSAPP_OUTBOUND_MODE | disabled |

Os valores foram lidos pela API de configuração. Não foi invocado o worker de produção para inferir os valores carregados em memória, pois essa invocação poderia alterar jobs reais. Segredos não foram usados nos testes locais ou incluídos neste relatório.

## Persistência e regressões

Os seis novos testes de contrato exercitam o handler real, sessões sintéticas e um adaptador REST em memória: criação/edição de lead, leituras repetidas, novo login, preservação de configurações, escritas concorrentes, revisão obsoleta, retry duplicado, criação/reagendamento/conclusão de tarefas, payload inválido, bloqueio de apagamento completo, acesso sem sessão, origem indevida e falha de comunicação seguida de recuperação.

Isso valida o contrato da API, sem demonstrar persistência física após reinício de um banco. A CI executou em PostgreSQL 16 efêmero as suítes de automações, privilégios, resolução manual, experiência do cliente, endurecimento, trigger de follow-ups, advisor, horários, isolamento de claim e primeira resposta. O banco oficial usa PostgreSQL 17.11; não foi executada a mesma suíte em uma réplica efêmera dessa versão.

A leitura oficial encontrou uma linha de estado, revisão 42, atualização em 19/10/2026 às 14:29:59 UTC; isso demonstra estado existente, não atribui sua gravação a esta sessão. O health de produção retornou HTTP 200 com o projeto correto; GET privado sem sessão retornou 401.

## Banco, filas e segurança

- Cinco tabelas com RLS habilitado; nenhuma permissão direta de tabela para anon/authenticated na consulta executada.
- Quinze funções públicas consultadas sem EXECUTE para anon/authenticated e com search_path fixado. As funções SECURITY DEFINER são restritas ao servidor nas verificações realizadas.
- Constraints, índices de unicidade, relacionamentos e trigger de follow-ups encontrados. Foram lidas 18 entradas de histórico de migrações; seus identificadores diferem dos nomes locais. Não se presume equivalência integral de todas as definições apenas pelos nomes.
- Advisors de segurança e performance retornaram lista vazia.
- Fila: 20 itens; tentativas: 22. Internos: quatro dead_letter, um pending, um awaiting_operator, dois completed. Externos históricos: 11 sent e um dead_letter.
- Esses estados são históricos: não demonstram mensagens enviadas nesta sessão e não foram modificados.
- A definição oficial do claim interno usa filtro `channel = 'internal'` e `FOR UPDATE SKIP LOCKED`, com recuperação de lock após dez minutos. A CI confirmou a exclusão de WhatsApp/Google review desse claim.

A autenticação atual usa senha compartilhada. Esta auditoria não certifica segregação individual de usuários/roles, revogação central de sessões nem isolamento entre organizações. Não foram realizados testes de carga, ataques a contas reais ou leitura de dados pessoais para o relatório.

## Defeito comprovado e correção

BUG-01, severidade moderada: `decodeURIComponent` era executado antes do try/catch da sessão. Um cookie `crm_session=%` causa `URIError: URI malformed`, em vez de rejeitar a sessão.

Reprodução antes da mudança: teste falha com stack em `validSession`, crm-state.mjs, linha 71. Correção mínima: mover decodificação e divisão do token para dentro do try/catch. Depois: três cookies malformados são rejeitados com 401; regressão final com 106/106 aprovados.

A correção está somente no PR #29. Não está em produção. Rollback após eventual publicação: reverter o commit/PR e restaurar o deploy anterior conhecido; não exige migração ou restauração de dados.

## Incidente HTTP 500

Request `01M59HBXGGW19QK9NZHPWDK6NP`: confirmado em 19/10 às 07:35:10.608 UTC, POST do scheduler, status 500, content-type text/plain, 409 bytes e duração aproximada de 1,36 segundo.

O registro retorna `has_function_invocation=false`, nenhuma operação e logs vazios. Outra requisição às 07:35:12.853 UTC, ID `01M59HBZPNMACG7YJZTAYDCQFM`, tem invocação registrada e status 200. As execuções de cinco em cinco minutos seguintes, até 07:55 na janela consultada, também retornaram 200.

O handler inspecionado devolve 503 no catch de nível superior, não 500. As evidências são compatíveis com falha fora do caminho tratado do handler, mas não comprovam a origem. Não há stack trace ou resposta original suficiente para concluir se foi plataforma, inicialização ou outra falha. Não foi relacionada aos telefones inválidos, token Meta ou banco sem evidência. Não foi aplicada correção especulativa. O defeito de cookie pertence ao crm-state e não explica este incidente do worker.

## WhatsApp e pesquisa

A suíte existente exercita envio com fetch simulado, ID do provedor, erros HTTP 400/401/403/429/500, resposta sem ID, falha de conexão/resultado ambíguo, allowlist, modo desabilitado, assinatura HMAC, rejeição de assinatura inválida, status, inbound e coexistência. Os cinco códigos HTTP são exercitados individualmente no mock de rejeição. Não foram validados limites reais do provedor.

A CI SQL passou os fluxos de pesquisa/recuperação e proteção da primeira resposta, incluindo resposta conflitante posterior, replay, correlação de pesquisa e prevenção de trabalho adicional indevido. Nenhum convite ou pesquisa real foi enviado.

## Matriz de homologação

Os estados abaixo descrevem o escopo completo solicitado, distinguindo aprovações parciais nas evidências.

| Componente | Estado | Evidência/pendência |
|---|---|---|
| Autenticação | REPROVADO | Defeito de cookie no código publicado; correção aprovada em branch |
| Cadastro e persistência | BLOQUEADO | Contratos aprovados; falta E2E integrado com navegador e banco |
| Follow-ups | APROVADO | Contratos, lifecycle e regressões SQL no ambiente isolado |
| Banco de dados | APROVADO | SQL efêmero, RLS/grants/advisors em leitura; limites de versão e drift registrados |
| Automação interna | APROVADO | Lifecycle, SQL, isolamento e locks; incidente de infraestrutura permanece separado |
| WhatsApp | BLOQUEADO | Mocks e bloqueio aprovados; homologação live fora do escopo |
| Webhooks | APROVADO | Contratos com HMAC, duplicação, inbound e status simulados |
| Pesquisa de satisfação | APROVADO | Unitários e SQL, incluindo primeira resposta |
| Segurança | REPROVADO | Cookie malformado ainda afeta a versão publicada; restante limitado ao escopo verificado |
| Integração entre componentes | BLOQUEADO | Falta E2E integral e confirmação de equivalência completa do schema |
| Interface | BLOQUEADO | Quatro páginas com sintaxe válida e tela de login inspecionada no navegador remoto; E2E autenticado/mobile pendente |
| Recuperação de falhas | BLOQUEADO | Retries e locks aprovados; HTTP 500 sem causa comprovada |
| Prontidão para produção | BLOQUEADO | Correção pendente, E2E incompleto e incidente aberto |

## Respostas executivas

1. **Operacional internamente?** Há evidências de disponibilidade e estado persistido, mas a sessão não certifica todos os fluxos de uso interno.
2. **Persistência validada?** Contrato e componentes SQL aprovados; persistência ponta a ponta completa ainda bloqueada.
3. **Motor interno homologado?** Aprovado nos testes isolados executados; confiabilidade operacional integral depende do incidente e E2E.
4. **Duplicidade/perda comprovada?** Não foi reproduzida perda ou duplicidade nos casos executados. Não é garantia universal: cenários fora da cobertura continuam não certificados.
5. **HTTP 500 diagnosticado/corrigido?** Não. Ocorrência e recuperação observadas; causa raiz não comprovada.
6. **Integrações externas seguras/bloqueadas?** Flags consultadas bloqueiam outbound e testes confirmam fail-closed. Nenhuma chamada real de envio nesta sessão. Não certifica toda a segurança externa.
7. **Pronto?** Componentes testados de follow-up, fila interna, pesquisa, webhooks simulados e SQL; correção da sessão pronta para revisão.
8. **O que impede conclusão?** Correção não publicada, E2E visual/integrado ausente, comparação integral de schema pendente e incidente 500 aberto.
9. **O que exige humano?** Revisão/liberação final de produção e eventual autenticação de serviços se exigida. E2E pode ser concluído por automação em ambiente com navegador; não requer que o usuário faça cliques de teste. Investigação adicional do 500 depende de telemetria não retornada pelas ferramentas atuais, possivelmente suporte Netlify.
10. **Homologado para operação interna independentemente do WhatsApp?** Ainda não integralmente. A indisponibilidade de WhatsApp não é o motivo único: existem pendências internas acima.

## Limitações e continuidade

A instalação local de PostgreSQL falhou por restrições do ambiente; a alternativa executada com sucesso foi a CI em banco efêmero. Playwright estava disponível, mas sem executável de navegador; o download de Chromium retornou arquivo inválido e falhou. Como alternativa, o navegador remoto abriu o CRM oficial e permitiu verificar visualmente a tela de acesso desktop e o campo de senha, sem autenticar ou alterar dados. Não houve validação das telas autenticadas ou mobile. O navegador remoto não oferece aqui a interceptação de rede necessária para o E2E isolado com mocks; o navegador local permaneceu indisponível.

Este relatório distingue os resultados desta sessão de afirmações anteriores: os antigos relatos de salvamento após login e testes manuais não foram contabilizados como novos testes. Não houve uso das credenciais reais nos mocks. Nenhuma alteração de produção foi executada.

## Verificação complementar final

O mock de rejeição WhatsApp passou para HTTP 400, 401, 403, 429 e 500; total permanece 106 casos Node. As novas execuções de CI do commit `1d54a9f30648d94c924dbcecdca1fbbaa253e8ed` estão em https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39304512921 e https://github.com/edisonpassos-netizen/crm-instituto-pamela-pastore/actions/runs/39304512825 . A consulta final de leitura manteve revisão 42, fila 20 e tentativas 22.
