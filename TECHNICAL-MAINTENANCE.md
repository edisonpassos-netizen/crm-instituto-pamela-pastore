# Manual Técnico de Manutenção — CRM Instituto Pâmela Pastore

Atualizado em 16/10/2026.

## Componentes

| Componente | Responsabilidade |
|---|---|
| `index.html` | CRM principal, estado comercial e autenticação visual |
| `followups-operacionais.html` | criação de retorno, fila manual e recuperação |
| `atendimentos-operacionais.html` | registro/conclusão/cancelamento de atendimentos |
| `crm-state.mjs` | autenticação, leitura/gravação do estado e API operacional |
| `automation-worker.mjs` | claim, reconciliação, retry e envio controlado |
| `whatsapp-status-webhook.mjs` | verificação Meta, status e inbound |
| `crm-database.mjs` | isolamento obrigatório do Supabase exclusivo |
| `automation-event-adapter.mjs` | allowlist de eventos de domínio |
| `automation-enqueue.mjs` | verificação de estado persistido e enqueue |
| `customer-experience.mjs` | classificação estrita de satisfação |
| `followup-schedule.mjs` | cálculo de data/hora do follow-up no fuso operacional |
| `whatsapp-outbound-config.mjs` | gates, allowlists e configuração de outbound |
| Supabase migrations | schema, RPCs, triggers, RLS, índices e hardening |

## Inventário de variáveis de ambiente

Nunca documentar valores reais de segredo. O inventário abaixo contém apenas nomes e finalidade.

| Variável | Sensível | Uso |
|---|---:|---|
| `SUPABASE_URL` | não | URL do projeto exclusivo `dxfzuxybubvnjertiowf` |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | acesso de servidor ao Supabase |
| `CRM_ALLOWED_ORIGIN` | não | origem autorizada do CRM |
| `CRM_LOGIN_PASSWORD` | sim | senha de acesso da interface |
| `CRM_SESSION_SECRET` | sim | assinatura das sessões |
| `CRM_BUSINESS_TIME_ZONE` | não | fuso de follow-ups; esperado `America/Sao_Paulo` |
| `INTERNAL_AUTOMATIONS_ENABLED` | não | permite claim de canal interno |
| `AUTOMATIONS_ENABLED` | não | gate geral de automações externas |
| `CUSTOMER_EXPERIENCE_ENABLED` | não | gate de criação do fluxo de experiência |
| `AUTOMATION_BATCH_SIZE` | não | limite opcional por execução do worker |
| `WHATSAPP_TEST_MODE` | não | gate adicional do modo de teste |
| `WHATSAPP_OUTBOUND_MODE` | não | `disabled`, `test` ou `production` |
| `WHATSAPP_PRODUCTION_ENABLED` | não | segundo gate explícito de produção |
| `WHATSAPP_GRAPH_API_VERSION` | não | versão da Graph API |
| `WHATSAPP_ACCESS_TOKEN` | sim | token de servidor Meta |
| `WHATSAPP_APP_SECRET` | sim | validação HMAC do webhook |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | sim | desafio GET do webhook |
| `WHATSAPP_PHONE_NUMBER_ID` | não/sensível operacional | remetente de homologação/teste |
| `WHATSAPP_TEMPLATE_NAME` | não | template de homologação |
| `WHATSAPP_TEMPLATE_LANGUAGE` | não | idioma de homologação |
| `WHATSAPP_TEST_RECIPIENTS` | sensível operacional | allowlist de números de teste |
| `WHATSAPP_PRODUCTION_PHONE_NUMBER_ID` | sensível operacional | remetente oficial após homologação |
| `WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES` | não | allowlist de países, esperado `55` |
| `WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_NAME` | não | template de pesquisa aprovado |
| `WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_LANGUAGE` | não | idioma da pesquisa |
| `WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_NAME` | não | template neutro de avaliação |
| `WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_LANGUAGE` | não | idioma do convite |

Segredos devem existir somente em armazenamento de ambiente adequado, com escopo de Functions quando aplicável. Não colocar `.env` real no GitHub.

## Matriz de permissões

| Recurso | Browser/anon | authenticated Supabase | Netlify server/service_role | Observação |
|---|---:|---:|---:|---|
| `crm_app_state` | não | não | sim | browser usa `crm-state` |
| `crm_automation_queue` | não | não | sim | fila server-only |
| `crm_automation_attempts` | não | não | sim | auditoria server-only |
| `crm_customer_experience` | não | não | sim | fluxo de experiência |
| `crm_whatsapp_messages` | não | não | sim | inbound/status persistido |
| `enqueue_crm_automation` | não | não | sim | dedupe central |
| claim RPCs | não | não | sim | worker |
| result RPCs | não | não | sim | API operacional |
| experience RPCs | não | não | sim | webhook/worker/API |
| trigger de follow-up | não | não | executado pelo DB | valida origem e dedupe |

As políticas RLS são defesa adicional; não substituem a revogação de privilégios diretos.

## Migrations de produção

O histórico oficial deve ser conferido com `Supabase.list_migrations` antes de qualquer nova migration. Em 16/10/2026 o projeto inclui, entre outras, estas etapas funcionais:

- `automation_engine`
- `delivery_unknown`
- `whatsapp_status`
- `crm_app_state_test_bootstrap`
- `followup_awaiting_operator_test`
- `harden_automation_privileges_test`
- `atomic_manual_queue_resolution_test`
- `claim_internal_automation_jobs`
- `manual_result_task_sync`
- `whatsapp_inbound_messages`
- `customer_experience_flow`
- `customer_experience_send_completion`
- `preproduction_audit_hardening`
- `atomic_main_followup_enqueue`
- `followup_source_integrity`
- `supabase_advisor_hardening`
- `followup_time_support`

Nunca reaplicar migration destrutiva “na tentativa”. Conferir primeiro o estado do schema, os objetos existentes e a versão registrada.

## Saúde do sistema

### Netlify

Verificar:

- deploy publicado em `ready`;
- commit publicado igual ao `main` esperado;
- secret scan sem matches;
- `crm-state`, `automation-worker` e `whatsapp-status-webhook` presentes;
- worker agendado `*/5 * * * *`;
- ausência de crescimento anormal de 5xx.

### Supabase

Verificar:

- logs PostgreSQL sem ERROR/FATAL inesperado;
- security advisor sem lints críticos;
- filas por `status` e `channel`;
- contagem de `delivery_unknown`;
- `dead_letter` novos;
- locks antigos em `processing`;
- RLS e grants das tabelas críticas;
- revisão de `crm_app_state` crescendo de forma coerente.

### Meta

Após ativação futura, acompanhar:

- `provider_message_id` por tentativa;
- estados `sent`, `delivered`, `read`, `failed`;
- erros com código do provedor;
- webhook assinado chegando ao endpoint;
- inbound duplicado sendo reconhecido sem segunda execução.

## CI

Ambiente principal da CI:

- Node.js 24;
- PostgreSQL 16 efêmero;
- nenhuma credencial real;
- Supabase sintético apontando somente para validação de código.

Comandos locais equivalentes, quando houver checkout confiável:

```bash
node --check netlify/functions/crm-state.mjs
node --check netlify/functions/automation-worker.mjs
node --check netlify/functions/whatsapp-status-webhook.mjs
node --test tests/*.test.mjs
```

A integração SQL é validada pela workflow `automation-tests.yml`, que aplica migrations em PostgreSQL efêmero antes das asserções.

## Política de mudanças

1. Criar branch específica.
2. Alterar o menor escopo possível.
3. Adicionar/atualizar teste que reproduza o risco.
4. Abrir PR.
5. Só integrar com CI verde.
6. Aplicar migration oficial depois do merge, quando houver migration.
7. Verificar deploy Netlify e logs.
8. Manter outbound desligado salvo quando a mudança for explicitamente de ativação homologada.

Mudanças em credenciais, número oficial, App Review, envio real e exclusão de dados exigem tratamento de mudança crítica, com rollback conhecido.

## Diagnóstico por sintoma

### HTTP 409 ao salvar CRM

Causa provável: revisão concorrente ou trava de proteção. Recarregar o estado, reconciliar a mudança e salvar novamente. Não contornar removendo `revision`.

### Follow-up não aparece na fila manual

Checar, nesta ordem:

- task realmente persistida;
- `done=false`;
- `leadId` existente no mesmo snapshot;
- data válida;
- job interno existente/deduplicado;
- `scheduled_at`/`due_at` ainda no futuro;
- `INTERNAL_AUTOMATIONS_ENABLED=true`;
- worker executando.

### Follow-up em dead letter

Ler `last_error` e `crm_automation_attempts`. Corrigir a origem (lead, telefone, data/time) antes de criar qualquer substituição manual.

### `delivery_unknown`

Não reenviar automaticamente. Primeiro reconciliar no provedor e no histórico de webhook. O estado existe exatamente para impedir duplicidade em situação ambígua.

### Pesquisa não é criada

Se `CUSTOMER_EXPERIENCE_ENABLED=false`, isso é comportamento esperado. Quando habilitado, verificar atendimento `Concluído`, autorização registrada, `consentAt` e telefone válido.

### Webhook 401

Verificar assinatura HMAC/App Secret. Nunca desabilitar a verificação para “fazer funcionar”.

## Governança pendente

O repositório ainda é público e a conexão atual não possui permissão administrativa para torná-lo privado ou aplicar branch protection. Antes do go-live completo, recomenda-se:

- tornar o repositório privado;
- proteger `main` com PR + CI obrigatória;
- restringir quem pode fazer push direto;
- revisar acesso dos colaboradores.

Há também uma rotação futura recomendada do token de verificação de webhook, coordenada entre Netlify e Meta para evitar interrupção. Não fazer rotação parcial.

## Manutenção de compatibilidade

- Não remover a RPC v2 imediatamente; a v3 foi adicionada para data+hora sem quebrar rollback/legado.
- Tarefas antigas sem `time` continuam válidas.
- Não alterar os payloads estáveis dos botões de satisfação sem migration/teste correspondente.
- Não reutilizar `hello_world` como fallback em produção.
- Não substituir o Phone Number ID de teste pelo oficial sem os gates e a janela de homologação.
