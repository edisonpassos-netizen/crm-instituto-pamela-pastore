# Plano de Testes — CRM Instituto Pâmela Pastore

Atualizado em 16/10/2026.

## Objetivo

Comprovar que CRM, filas, atendimento, follow-up, experiência, webhook e WhatsApp controlado funcionam sem duplicidade, perda silenciosa de estado ou envio indevido. Testes automatizados nunca devem utilizar clientes reais.

## Princípios

- Todo teste de banco usa PostgreSQL efêmero ou dados sintéticos controlados.
- Testes de outbound usam `fetch` mockado, salvo uma homologação explicitamente autorizada.
- Produção permanece `fail-closed` durante desenvolvimento e pré-produção.
- Erro externo ambíguo nunca pode resultar em retry automático.
- Cada bug corrigido deve ganhar teste que falhava antes da correção.

## Camadas

### 1. Sintaxe e carregamento

Verificar `node --check` nas Functions e helpers críticos. Validar também JavaScript inline das páginas operacionais.

Aceite: nenhum erro de parse no Node 24 e nenhuma referência a segredo no frontend.

### 2. Isolamento do banco

Casos:

- URL `dxfzuxybubvnjertiowf` + credencial server-side válida: aceita.
- projeto legado `pposribyzhxyupbxrpfo`: rejeita antes de fetch.
- qualquer outro projeto: rejeita.
- publishable/anon key usada como service credential: rejeita.

Aceite: todas as Functions de dados herdam o mesmo guard.

### 3. Autenticação e origem

Casos:

- login correto cria sessão assinada HttpOnly/Secure/SameSite Strict;
- senha errada retorna 401;
- sessão inválida/expirada retorna 401;
- origem não permitida retorna 403;
- health endpoint não expõe dados de clientes.

### 4. Estado e concorrência

Casos:

- GET retorna `revision` atual;
- PUT com revisão correta avança exatamente uma revisão;
- PUT obsoleto retorna 409;
- tentativa de zerar todas as coleções comerciais a partir de estado não vazio é bloqueada;
- alteração normal de registros permanece possível.

### 5. Follow-up principal

Casos SQL:

- task nova, pendente, com lead existente e data válida gera exatamente um job interno;
- editar a mesma task não duplica job;
- task concluída não gera job;
- task sem `leadId` não gera job;
- task com data inválida não gera job;
- task cujo lead não existe não gera job;
- `anon` e `authenticated` não executam a função sensível.

### 6. Data e horário de follow-up

Casos:

- `2026-10-17 09:30` em `America/Sao_Paulo` converte para instante UTC correto;
- task histórica somente com data conserva comportamento legado;
- horário `25:00` é rejeitado;
- data impossível é rejeitada;
- timezone inválido falha fechado;
- novo follow-up da página exige data + horário;
- reagendamento de follow-up envia data + horário à RPC v3;
- recuperação de experiência mantém seu contrato separado.

Aceite: o worker só disponibiliza o item ao operador quando `due_at` é atingido.

### 7. Resultado manual de follow-up

Casos:

- contacted conclui fila e task;
- no_answer registra auditoria;
- not_contacted registra auditoria;
- rescheduled conclui task original, cria nova task e exatamente um job interno;
- v3 persiste `time` quando informado;
- resultado inválido é rejeitado antes do banco;
- segunda resolução da mesma fila retorna conflito.

Nunca afirmar “mensagem enviada” num resultado manual.

### 8. Atendimento concluído

Casos:

- registrar atendimento cria estado `Agendado`;
- cancelar preserva histórico;
- concluir sem consentimento não emite `service_completed`;
- concluir com consentimento e telefone inválido bloqueia o evento;
- concluir com consentimento e telefone válido emite somente `service_completed`;
- página não contém chamada direta à Meta.

### 9. Feature gate de experiência

Com `CUSTOMER_EXPERIENCE_ENABLED=false`:

- `service_completed` é consumido sem criar experiência;
- nenhum job externo é criado;
- nenhum network call de outbound ocorre.

Com gate habilitado em ambiente de teste:

- attendance precisa estar `Concluído`;
- consentimento e timestamp de consentimento precisam existir;
- telefone e lead são relidos do estado persistido;
- dados de contato do evento cliente são ignorados.

### 10. Pesquisa de satisfação

Casos:

- template de produção é dedicado à satisfação;
- quick replies têm índices e payloads estáveis;
- `experience_very_good` -> `very_good`;
- `Excelente` como fallback textual -> `very_good`;
- `experience_good` -> `good`;
- `experience_needs_improvement` -> `needs_improvement`;
- texto livre não suportado -> nenhuma classificação automática.

### 11. Recuperação de experiência

Casos:

- `needs_improvement` cria somente job interno de recuperação;
- worker prepara `awaiting_operator`;
- resolved/unresolved/rescheduled são tratados pela RPC dedicada;
- resultado resolvido ou encerrado prepara convite neutro conforme regra atual;
- não há pedido de nota/estrelas.

### 12. Convite Google

Casos:

- só experiência em `review_pending` é elegível;
- telefone da fila precisa bater com experiência;
- URL oficial é relida de `crm_app_state.settings.reviewUrl` imediatamente antes do envio;
- URL não HTTPS cancela/impede o job;
- template de review é separado do template de satisfação;
- `hello_world` nunca é fallback de produção.

### 13. Configuração outbound

Casos:

- sem `WHATSAPP_OUTBOUND_MODE`: bloqueado;
- `disabled`: bloqueado;
- test sem gate ou fora da allowlist: bloqueado;
- production sem `WHATSAPP_PRODUCTION_ENABLED=true`: bloqueado;
- production sem Phone Number ID oficial: bloqueado;
- país fora da allowlist: bloqueado;
- template de cada evento ausente: bloqueado.

### 14. Meta API mockada

Casos:

- 2xx + `messages[0].id`: sucesso;
- 2xx sem message id: `delivery_unknown`;
- timeout/conexão interrompida após início da chamada: `delivery_unknown`;
- erro HTTP conhecido: retry/dead letter conforme tentativas;
- nenhum segredo aparece na mensagem de erro.

### 15. Webhook

Casos:

- GET com verify token correto devolve challenge;
- verify token errado rejeita;
- POST sem assinatura HMAC rejeita antes de acessar DB;
- status aceito atualiza tentativa correspondente;
- inbound é persistido;
- provider message id duplicado não cria segunda mensagem nem reroda classificação;
- contexto da resposta é preservado para correlação da experiência.

## Cenários end-to-end de pré-produção

### E2E A — follow-up interno

1. Cadastrar lead sintético.
2. Criar retorno para horário futuro.
3. Confirmar um job interno único.
4. Confirmar que worker mantém pendente até `due_at`.
5. Após due, confirmar `awaiting_operator`.
6. Registrar contacted.
7. Confirmar task concluída, queue completed e audit attempt.
8. Confirmar zero chamadas Meta.

### E2E B — follow-up reagendado

1. Item em `awaiting_operator`.
2. Escolher Cliente pediu retorno.
3. Informar data + horário futuro.
4. Confirmar task original concluída.
5. Confirmar nova task com `time`.
6. Confirmar exatamente um job interno novo.

### E2E C — atendimento sem consentimento

1. Registrar atendimento sintético.
2. Concluir sem consentimento.
3. Confirmar nenhum automationEvent externo/experience row.

### E2E D — experiência com gate desligado

1. Concluir atendimento sintético com consentimento.
2. Confirmar evento aceito como no-op.
3. Confirmar zero experiência e zero job externo.

### E2E E — fluxo completo simulado

Somente em ambiente isolado com gate de experiência habilitado e Meta mockada:

1. Concluir atendimento consentido.
2. Criar satisfaction request.
3. Simular provider message id.
4. Simular resposta Excelente.
5. Confirmar review_pending/review invitation.
6. Repetir com Poderia melhorar.
7. Confirmar recuperação interna, resolução e convite neutro posterior.

## Homologação futura do número oficial

Esta etapa não faz parte da CI automática. Só executar depois de templates aprovados e estratégia de coexistência confirmada.

Critérios mínimos:

- número oficial preserva operação diária;
- Phone Number ID oficial confirmado;
- teste somente com número interno autorizado;
- uma mensagem por cenário;
- webhook `sent/delivered/read` confirmado;
- inbound confirmado;
- nenhum retry duplicado;
- flags restauradas ao modo seguro após teste, se produção ainda não tiver sido aprovada.

## Critério de aprovação do release

Release técnico pode avançar quando:

- CI inteira verde;
- migration nova passa em PostgreSQL efêmero;
- migration oficial aplicada com validação pós-migração;
- Netlify deploy `ready` no commit esperado;
- secret scan sem matches;
- logs sem 5xx/erros novos relevantes;
- contadores externos compatíveis com o estágio (pré-produção: zero jobs externos ativos);
- gates continuam no estado previsto.
