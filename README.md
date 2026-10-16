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

Em produção, enquanto os canais externos não estiverem liberados, mantenha explicitamente:
- `INTERNAL_AUTOMATIONS_ENABLED=true` — autoriza apenas o processamento interno necessário para transformar follow-ups validados em itens `awaiting_operator`.
- `AUTOMATIONS_ENABLED=false` — impede que o worker reivindique filas externas de WhatsApp ou Google Review.
- `WHATSAPP_TEST_MODE=false` — mantém desligado o modo de homologação.
- `WHATSAPP_OUTBOUND_MODE=disabled` — trava explícita do canal de saída. Se ausente, o código continua fail-closed, exceto quando `WHATSAPP_TEST_MODE=true`, que preserva o comportamento de homologação já validado.
- `WHATSAPP_PRODUCTION_ENABLED=false` — segunda trava independente para produção real.

Quando somente `INTERNAL_AUTOMATIONS_ENABLED=true`, o worker usa exclusivamente `claim_due_internal_automation_jobs`, RPC que filtra `channel='internal'` e não reivindica canais externos. O RPC é restrito a `service_role`.

## Homologação WhatsApp Cloud API

A homologação usa configuração separada da Meta:
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — segredo usado apenas no handshake GET de verificação do webhook; nunca gravar o valor no repositório.
- `WHATSAPP_APP_SECRET` — segredo do app Meta, necessário para validar `x-hub-signature-256` em webhooks POST.
- `WHATSAPP_ACCESS_TOKEN` — token de System User da Cloud API; deve existir somente em variável secreta de servidor.
- `WHATSAPP_PHONE_NUMBER_ID` — ID do número de teste fornecido pela Meta.
- `WHATSAPP_GRAPH_API_VERSION=v26.0` — versão fixada para a homologação atual.
- `WHATSAPP_TEMPLATE_NAME=hello_world` — template padrão da Meta usado no primeiro envio controlado.
- `WHATSAPP_TEMPLATE_LANGUAGE=en_US` — idioma do template `hello_world`.
- `WHATSAPP_TEST_RECIPIENTS` — allowlist explícita de números autorizados para testes.

Em modo de teste, o worker exige simultaneamente `WHATSAPP_TEST_MODE=true`, credenciais válidas e destinatário presente na allowlist. A ausência de qualquer condição falha de forma fechada.

## Modo de produção do WhatsApp

O modo de produção é separado do teste e não reutiliza silenciosamente Phone Number ID nem templates de homologação. Para uma futura ativação real serão necessários, além de `AUTOMATIONS_ENABLED=true`:
- `WHATSAPP_OUTBOUND_MODE=production`
- `WHATSAPP_PRODUCTION_ENABLED=true`
- `WHATSAPP_PRODUCTION_PHONE_NUMBER_ID` — Phone Number ID do número oficial do Instituto.
- `WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES` — lista explícita de códigos de país autorizados; para operação apenas no Brasil, usar `55`.
- `WHATSAPP_PRODUCTION_TEMPLATE_NAME` e `WHATSAPP_PRODUCTION_TEMPLATE_LANGUAGE` — template padrão aprovado para mensagens comerciais implementadas futuramente.
- `WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_NAME` e `WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_LANGUAGE` — template aprovado exclusivamente para pedido de avaliação Google.

O canal `google_review` seleciona obrigatoriamente o template de avaliação. O código não usa `hello_world` como fallback em produção. A produção continua bloqueada até que número oficial, templates aprovados e controles operacionais sejam homologados separadamente.

A configuração deve ser republicada após qualquer alteração de variável para garantir que o runtime das Functions receba os valores novos.

## Autenticação
A função exige uma sessão assinada, armazenada em cookie `HttpOnly; Secure; SameSite=Strict` com validade de 8 horas. A origem/CORS é uma camada adicional e não substitui autenticação.

## Deploy
A raiz do site é o diretório do projeto; as funções devem ser publicadas a partir de `netlify/functions/`. O workflow `.github/workflows/import-netlify-page.yml` importa a interface atual do site Netlify para o repositório quando executado manualmente.

## Antes de usar com dados reais
- Conectar o número oficial ao app Meta correto sem substituir a configuração de teste antes da validação.
- Criar e aprovar os templates reais em português.
- Configurar as variáveis `WHATSAPP_PRODUCTION_*` sem habilitar as duas travas de produção.
- Confirmar que o deploy publica as funções esperadas.
- Testar login, leitura, gravação, edição e persistência após recarregar.
- Executar uma homologação controlada do número oficial antes de habilitar filas reais.
- Manter automações externas bloqueadas até homologação específica do canal.
- Tornar o repositório privado, pois contém código proprietário do CRM.

## Banco exclusivo do CRM

Este CRM deve usar somente o projeto `crm-automation-test` (`dxfzuxybubvnjertiowf`), com `SUPABASE_URL=https://dxfzuxybubvnjertiowf.supabase.co` e uma chave de servidor desse mesmo projeto. `crm-state`, `automation-worker` e `whatsapp-status-webhook` reutilizam a mesma validação e rejeitam URLs diferentes antes de enviar qualquer chamada ao banco. A Agenda Pilates permanece no projeto `studio-pamela-aluno` e não pode ser usada pelos caminhos do CRM.

A variável `SUPABASE_SERVICE_ROLE_KEY` aceita uma chave moderna `sb_secret_` ou uma chave legada `service_role` do projeto do CRM. Chaves modernas são enviadas apenas no cabeçalho `apikey`; chaves legadas também usam `Authorization`. Nenhuma chave real deve ser incluída em arquivos de teste ou commits.

Execute `node --test tests/*.test.mjs` para conferir o destino, a rejeição de chaves de outro projeto, a autenticação, worker/webhook e a proteção contra revisão desatualizada. Os testes HTTP usam respostas simuladas.

Mudanças de banco ou credenciais em produção devem preservar o isolamento do CRM, validar leitura/gravação e manter rollback disponível antes de revogar qualquer credencial anterior. Não revogue credenciais compartilhadas sem identificar seus outros consumidores.

> Homologação do envio outbound pelo backend concluída com sucesso em 16/10/2026 usando token de System User; uma única mensagem de teste foi aceita pela Cloud API e as travas externas foram restauradas imediatamente após o resultado.
