# CRM — Instituto Pâmela Pastore

Repositório do CRM publicado no Netlify, com persistência no Supabase.

## Estrutura
- `index.html`: interface do CRM e tela de acesso.
- `followups-operacionais.html`: fila autenticada de follow-ups e recuperação de experiência.
- `netlify/functions/crm-state.mjs`: API de leitura/gravação, autenticação e resultados operacionais.
- `netlify/functions/automation-worker.mjs`: worker agendado de automações, fail-closed por padrão.
- `netlify/functions/whatsapp-status-webhook.mjs`: webhook assinado para status, mensagens inbound e respostas da pesquisa de experiência.
- `netlify/functions/lib/customer-experience.mjs`: classificação estrita das respostas da pesquisa.
- `netlify.toml`: configuração de build e funções.

## Variáveis obrigatórias no Netlify
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — secreta; nunca colocar no repositório ou no navegador.
- `CRM_ALLOWED_ORIGIN` — por exemplo, `https://peppy-salamander-2d8776.netlify.app`.
- `CRM_LOGIN_PASSWORD` — senha de acesso ao CRM, com pelo menos 12 caracteres.
- `CRM_SESSION_SECRET` — segredo aleatório com pelo menos 32 caracteres para assinar sessões.

Não use o mesmo valor para a senha e o segredo de sessão. Configure valores secretos diretamente no Netlify; nunca publique credenciais no GitHub ou em chats.

## Travas de automação
Enquanto canais externos não estiverem liberados, mantenha:
- `INTERNAL_AUTOMATIONS_ENABLED=true`
- `AUTOMATIONS_ENABLED=false`
- `CUSTOMER_EXPERIENCE_ENABLED=false` — impede inclusive a criação de novas pesquisas/fila enquanto a implantação não estiver homologada.
- `WHATSAPP_TEST_MODE=false`
- `WHATSAPP_OUTBOUND_MODE=disabled`
- `WHATSAPP_PRODUCTION_ENABLED=false`

Com `CUSTOMER_EXPERIENCE_ENABLED=false`, um evento futuro de atendimento concluído é aceito como no-op e **não cria** `crm_customer_experience` nem fila externa. Isso evita acumular pesquisas antigas que poderiam disparar quando o canal fosse ligado posteriormente.

Quando somente a automação interna está habilitada, o worker reivindica exclusivamente `channel='internal'`; WhatsApp e Google Review permanecem fora do claim.

## Fluxo de experiência do cliente
O CRM separa satisfação, recuperação e reputação:

`service_completed → satisfaction_request → satisfaction_response`

- **Muito boa** (`experience_very_good`) → prepara `review_invitation` neutro.
- **Boa** (`experience_good`) → prepara `review_invitation` neutro.
- **Poderia melhorar** (`experience_needs_improvement`) → cria `service_recovery_required` para a recepção.
- Após a recepção registrar o caso como resolvido **ou encerrado sem solução**, o CRM prepara o mesmo convite neutro de avaliação, com atraso operacional. O convite não pede nota nem estrelas.
- Respostas livres que não correspondem exatamente às opções suportadas são armazenadas como mensagens, mas não acionam classificação automática.

O estado durável vive em `crm_customer_experience`. Envios de pesquisa e avaliação usam finalização transacional: fila e experiência são atualizadas juntas depois que a Meta aceita a mensagem. Se a confirmação interna ficar ambígua, o job entra em `delivery_unknown` e não é reenviado automaticamente.

O link oficial do Google vem de `crm_app_state.data.settings.reviewUrl`; ele é lido novamente antes de cada convite, evitando URL antiga na fila.

## Templates de produção
O modo de produção é separado da homologação. Além de `CUSTOMER_EXPERIENCE_ENABLED=true` e `AUTOMATIONS_ENABLED=true`, exige `WHATSAPP_OUTBOUND_MODE=production` e `WHATSAPP_PRODUCTION_ENABLED=true`.

Variáveis:
- `WHATSAPP_PRODUCTION_PHONE_NUMBER_ID` — Phone Number ID oficial, ainda não deve ser configurado até a estratégia segura do número em uso ser homologada.
- `WHATSAPP_PRODUCTION_ALLOWED_COUNTRY_CODES=55`
- `WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_NAME=pesquisa_experiencia_pos_atendimento_v1`
- `WHATSAPP_PRODUCTION_SATISFACTION_TEMPLATE_LANGUAGE=pt_BR`
- `WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_NAME=avaliacao_google_pos_atendimento_v1`
- `WHATSAPP_PRODUCTION_REVIEW_TEMPLATE_LANGUAGE=pt_BR`
- `WHATSAPP_PRODUCTION_TEMPLATE_NAME` / `WHATSAPP_PRODUCTION_TEMPLATE_LANGUAGE` para outros casos futuros.

O template de satisfação deve usar opções estáveis equivalentes a:
- `experience_very_good` → Muito boa
- `experience_good` → Boa
- `experience_needs_improvement` → Poderia melhorar

O código nunca usa `hello_world` como fallback de produção.

## Homologação WhatsApp Cloud API
Variáveis de homologação:
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_API_VERSION=v26.0`
- `WHATSAPP_TEMPLATE_NAME=hello_world`
- `WHATSAPP_TEMPLATE_LANGUAGE=en_US`
- `WHATSAPP_TEST_RECIPIENTS`

O modo de teste exige simultaneamente `WHATSAPP_TEST_MODE=true` e destinatário presente na allowlist.

## Número oficial
O número oficial do Studio é **+55 15 99673-4292** e está em uso diário. Não registrar, migrar, substituir ou alterar esse número na Meta sem uma homologação específica que preserve a operação atual. O código de pré-produção não faz qualquer alteração nesse número.

## Banco exclusivo do CRM
Este CRM usa somente `dxfzuxybubvnjertiowf`. `crm-state`, `automation-worker` e `whatsapp-status-webhook` rejeitam outro projeto antes da chamada ao banco. A Agenda Pilates permanece isolada no projeto legado e não pode ser usada pelos caminhos do CRM.

As tabelas e RPCs de experiência são fechadas para `anon` e `authenticated`; o acesso de servidor é `service_role`/chave secreta validada.

## Testes
Execute:

`node --test tests/*.test.mjs`

A CI também cria PostgreSQL efêmero e valida migrations, RLS, satisfação, recuperação, convite pós-recuperação, idempotência e o feature gate antes de qualquer ativação.

## Antes de ativar dados reais
- manter todas as travas externas e `CUSTOMER_EXPERIENCE_ENABLED` desligadas;
- criar e aprovar os templates reais em português;
- definir a estratégia segura para o número oficial já em uso;
- homologar o Phone Number ID oficial sem interromper WhatsApp Business;
- fazer teste controlado com números internos;
- somente depois habilitar produção gradualmente.

> Homologação outbound do backend concluída em 16/10/2026 com token de System User; uma única mensagem de teste foi aceita pela Cloud API e as travas foram restauradas.
> Pré-produção permanece `disabled`, restrita ao Brasil (`55`) e preparada para `pt_BR`.
> Runtime republicado após configurar `CUSTOMER_EXPERIENCE_ENABLED=false`; o módulo está instalado, porém não cria novas pesquisas até ativação explícita.
> Templates de produção pré-configurados no Netlify em 16/10/2026: `pesquisa_experiencia_pos_atendimento_v1` e `avaliacao_google_pos_atendimento_v1`, ambos `pt_BR`.
