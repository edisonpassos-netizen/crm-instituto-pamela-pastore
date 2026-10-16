# CRM — Instituto Pâmela Pastore

Repositório do CRM publicado no Netlify, com persistência no Supabase.

## Estrutura
- `index.html`: interface do CRM e tela de acesso.
- `netlify/functions/crm-state.mjs`: API de leitura/gravação e autenticação por sessão.
- `netlify/functions/automation-worker.mjs`: worker agendado de automações, fail-closed por padrão.
- `netlify/functions/whatsapp-status-webhook.mjs`: webhook assinado para status do WhatsApp.
- `netlify.toml`: configuração de build e funções.
- `supabase/migrations/202610090001_create_crm_app_state.sql`: migration de referência para a tabela de estado.

## Variáveis obrigatórias no Netlify
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — secreta; nunca colocar no repositório ou no navegador.
- `CRM_ALLOWED_ORIGIN` — por exemplo, `https://peppy-salamander-2d8776.netlify.app`.
- `CRM_LOGIN_PASSWORD` — senha de acesso ao CRM, com pelo menos 12 caracteres.
- `CRM_SESSION_SECRET` — segredo aleatório com pelo menos 32 caracteres para assinar sessões.

Não use o mesmo valor para a senha e o segredo de sessão. Configure todos os valores secretos diretamente no painel do Netlify. Não os publique no GitHub nem os envie por chat.

## Travas de automação

Em produção, durante a fase de follow-up manual, mantenha explicitamente:
- `INTERNAL_AUTOMATIONS_ENABLED=true` — autoriza apenas o processamento interno necessário para transformar follow-ups validados em itens `awaiting_operator`.
- `AUTOMATIONS_ENABLED=false` — mantém bloqueados os canais externos e impede que o worker reivindique filas de WhatsApp ou Google Review.
- `WHATSAPP_TEST_MODE=false` — impede qualquer envio pela integração de WhatsApp.

Quando somente `INTERNAL_AUTOMATIONS_ENABLED=true`, o worker usa exclusivamente `claim_due_internal_automation_jobs`, RPC que filtra `channel='internal'` e não reivindica canais externos. O RPC é restrito a `service_role`.

Mesmo quando `AUTOMATIONS_ENABLED=true` for autorizado no futuro, o envio de WhatsApp continua exigindo separadamente `WHATSAPP_TEST_MODE=true`, credenciais válidas e destinatário presente na allowlist de teste. A ausência dessas condições deve falhar de forma fechada.

## Homologação WhatsApp Cloud API

A preparação de homologação mantém envios reais bloqueados e usa configuração separada da Meta:
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — segredo usado apenas no handshake GET de verificação do webhook; nunca gravar o valor no repositório.
- `WHATSAPP_APP_SECRET` — segredo do app Meta, necessário para validar `x-hub-signature-256` em webhooks POST.
- `WHATSAPP_ACCESS_TOKEN` — token de acesso da Cloud API; deve existir somente em variável secreta de servidor.
- `WHATSAPP_PHONE_NUMBER_ID` — ID do número de teste ou oficial fornecido pela Meta.
- `WHATSAPP_GRAPH_API_VERSION=v26.0` — versão fixada para a homologação atual.
- `WHATSAPP_TEMPLATE_NAME=hello_world` — template padrão da Meta usado apenas no primeiro envio controlado de homologação.
- `WHATSAPP_TEMPLATE_LANGUAGE=en_US` — idioma do template `hello_world`.
- `WHATSAPP_TEST_RECIPIENTS` — allowlist explícita de números autorizados para testes.

Durante a homologação, `AUTOMATIONS_ENABLED=false` e `WHATSAPP_TEST_MODE=false` permanecem obrigatórios até que credenciais, webhook, número de teste, template e allowlist tenham sido validados separadamente. O webhook POST deve rejeitar payloads sem assinatura válida, e o worker nunca deve enviar para um destinatário fora de `WHATSAPP_TEST_RECIPIENTS`.

A configuração de homologação deve ser republicada após qualquer alteração de variável para garantir que o runtime das Functions receba os valores novos. Após configurar ou rotacionar `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, template ou idioma, confirme sempre um deploy posterior à alteração antes de testar o envio.

## Autenticação
A função exige uma sessão assinada, armazenada em cookie `HttpOnly; Secure; SameSite=Strict` com validade de 8 horas. A origem/CORS é uma camada adicional e não substitui autenticação.

## Deploy
A raiz do site é o diretório do projeto; as funções devem ser publicadas a partir de `netlify/functions/`. O workflow `.github/workflows/import-netlify-page.yml` importa a interface atual do site Netlify para o repositório quando executado manualmente.

## Antes de usar com dados reais
- Conectar este repositório ao site Netlify correto.
- Configurar todas as variáveis acima.
- Confirmar que o deploy publica as funções esperadas.
- Testar login, leitura, gravação, edição e persistência após recarregar.
- Manter automações externas bloqueadas até homologação específica do canal.
- Tornar o repositório privado, pois contém código proprietário do CRM.

## Banco exclusivo do CRM

Este CRM deve usar somente o projeto `crm-automation-test` (`dxfzuxybubvnjertiowf`), com `SUPABASE_URL=https://dxfzuxybubvnjertiowf.supabase.co` e uma chave de servidor desse mesmo projeto. `crm-state`, `automation-worker` e `whatsapp-status-webhook` reutilizam a mesma validação e rejeitam URLs diferentes antes de enviar qualquer chamada ao banco. A Agenda Pilates permanece no projeto `studio-pamela-aluno` e não pode ser usada pelos caminhos do CRM.

A variável `SUPABASE_SERVICE_ROLE_KEY` aceita uma chave moderna `sb_secret_` ou uma chave legada `service_role` do projeto do CRM. Chaves modernas são enviadas apenas no cabeçalho `apikey`; chaves legadas também usam `Authorization`. Nenhuma chave real deve ser incluída em arquivos de teste ou commits.

Execute `node --test tests/*.test.mjs` para conferir o destino, a rejeição de chaves de outro projeto, a autenticação, worker/webhook e a proteção contra revisão desatualizada. Os testes HTTP usam respostas simuladas.

Mudanças de banco ou credenciais em produção devem preservar o isolamento do CRM, validar leitura/gravação e manter rollback disponível antes de revogar qualquer credencial anterior. Não revogue credenciais compartilhadas sem identificar seus outros consumidores.

> Homologação do envio outbound pelo backend concluída com sucesso em 16/10/2026 usando token de System User; uma única mensagem de teste foi aceita pela Cloud API e as travas externas foram restauradas imediatamente após o resultado.
