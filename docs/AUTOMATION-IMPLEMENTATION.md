# Implementação gradual das automações

Branch isolada: `feature/automation-engine`.

Nenhuma migração foi aplicada ao Supabase de produção. O worker deve permanecer desativado até aprovação explícita e testes em banco isolado.

## Etapas
1. Criar fila persistente com chave de deduplicação e log por tentativa.
2. Reivindicar tarefas atomicamente no banco para evitar execução concorrente.
3. Executar tarefas agendadas com tentativas progressivas e fila de falhas definitivas.
4. O CRM agora envia eventos internos explícitos de criação de follow-up após confirmar o salvamento; eventos nunca são inferidos de snapshots completos.
5. Integrar WhatsApp Business Platform oficial com modelo aprovado e webhook de status.
6. Enviar convite de avaliação somente após atendimento concluído, com consentimento, telefone e link HTTPS validado.
7. Testar isoladamente antes de qualquer ativação.

## Regras de segurança
- Não conceder permissões a `anon` ou `authenticated`.
- Segredos somente em variáveis de ambiente do servidor.
- `AUTOMATIONS_ENABLED` ausente ou `false` durante testes.
- Na etapa Meta, `WHATSAPP_TEST_MODE=true` é obrigatório e `WHATSAPP_TEST_RECIPIENTS` limita o envio aos números de teste expressamente permitidos. Se o modo não estiver ativo ou o destinatário não constar da lista, a função bloqueia a chamada antes da rede.
- Não aplicar migrações no projeto de produção nesta etapa.
- Confirmar suporte e limites de Scheduled Functions no plano Netlify.

## Limitações que precisam ser resolvidas antes da produção
- Conectar eventos reais do CRM à fila.
- Validar o modelo WhatsApp aprovado e seus parâmetros.
- Testar a API real somente com credenciais do app Meta e número de teste, em ambiente isolado que use projeto Supabase de teste. Não reutilizar variáveis de produção no deploy de teste.
- O primeiro envio real de validação será uma mensagem de teste ao número controlado pelo operador, não a clientes. A resposta HTTP da Meta indica aceitação; a confirmação de entrega deve chegar ao webhook.
- Nunca colar tokens, App Secret, verify token ou service-role key no chat, issues, commits ou logs.
- Implementar webhook autenticado de status da Meta para confirmar sent/delivered/read/failed; até lá, aceite da API não significa entrega.
- Respostas de rede ambíguas são marcadas `delivery_unknown` e exigem reconciliação manual antes de qualquer reenvio.
- Validar o link oficial de avaliação Google.

## Plano de ativação proposto (não autorizado ainda)
1. **Fase A — interno:** executar apenas tarefas internas em ambiente de teste por pelo menos 3 dias úteis; comparar fila, logs e CRM.
2. **Fase B — sandbox de integração:** testar API mockada e, quando disponível, número de teste Meta; sem clientes reais.
3. **Fase C — piloto controlado:** somente após aprovação explícita, usar modelo aprovado, consentimento comprovado, pequeno grupo interno de teste e webhook de status funcional.
4. **Fase D — expansão:** ampliar gradualmente com limites diários, alertas de falha, deduplicação e procedimento de pausa.

Critérios de avanço: CI verde; nenhum acesso público à fila; taxa de falhas explicada; entrega reconciliada via webhook; duplicatas e timeouts tratados; rollback documentado.
- Testar login, leads, tarefas, vendas e persistência do CRM atual.


## Integração de eventos e confirmação de entrega — testes da branch isolada

- Criar um follow-up no CRM gera um evento explícito `lead_follow_up_requested`, com canal `internal`; esse fluxo não manda WhatsApp.
- O backend valida o tipo do evento, cria uma chave de deduplicação e chama `enqueue_crm_automation` com credencial exclusivamente do servidor, após confirmar a gravação do estado do CRM.
- A interface mantém eventos não aceitos para novas tentativas; a chave única no banco torna o reenvio idempotente.
- `whatsapp-status-webhook.mjs` valida o desafio GET e a assinatura HMAC SHA-256 de POST antes de atualizar o registro de tentativa associado ao ID da mensagem.
- Testes de integração usam respostas HTTP simuladas e dados fictícios; nenhum cliente ou API da Meta recebe mensagens.
- Nova migração proposta `202610100003_whatsapp_status.sql` adiciona status do provedor e metadados de erro. Ela ainda não foi aplicada em qualquer banco.
- A confirmação real de entrega exige configuração da URL do webhook e segredo da Meta apenas em ambiente de teste; os testes do CI validam o contrato com assinatura/chaves fictícias, não a conexão real com a Meta.


## Pré-requisitos para o teste real da Meta (ainda não executado)

1. Criar/selecionar o app Meta de teste e o número de telefone de teste fornecido no painel WhatsApp > API Setup.
2. Adicionar somente o telefone de teste controlado pelo operador à lista de destinatários permitidos pelo painel.
3. Configurar um ambiente isolado de deploy e um projeto Supabase de teste. Não copiar dados do CRM nem apontar para o projeto de produção.
4. Configurar segredos no ambiente isolado, nunca no código: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; e `WHATSAPP_TEST_MODE=true`, `WHATSAPP_TEST_RECIPIENTS=<número de teste>`.
5. Usar um modelo que o painel identifique como aprovado. O template `hello_world` é somente um valor inicial possível; confirmar nome e idioma que aparecem no painel antes do teste.
6. Publicar o webhook isolado em HTTPS, configurar o callback e verificar a assinatura. Assinar o campo de webhook de mensagens/status da WABA de teste.
7. Fazer uma única execução supervisionada para o número de teste, confirmar ID `wamid` da resposta e depois o webhook `sent` / `delivered` / `read` ou `failed`. Se houver timeout ambíguo, não repetir automaticamente.
8. Desativar `WHATSAPP_TEST_MODE` e `AUTOMATIONS_ENABLED` após o teste; salvar apenas resultado técnico sem token ou número completo em logs.

**Bloqueio atual:** nenhum acesso autorizado à conta Meta nem credenciais de teste foram disponibilizados a esta sessão. Portanto, não foi feita chamada real à API nem alterada qualquer configuração de Meta/Netlify/Supabase. A configuração real permanece pendente desses acessos.
