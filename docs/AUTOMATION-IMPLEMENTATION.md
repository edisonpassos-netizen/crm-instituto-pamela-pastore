# Implementação gradual das automações

Branch isolada: `feature/automation-engine`.

Nenhuma migração foi aplicada ao Supabase de produção. O worker deve permanecer desativado até aprovação explícita e testes simulados com mocks e fixtures sintéticas.

## Etapas
1. Criar fila persistente com chave de deduplicação e log por tentativa.
2. Reivindicar tarefas atomicamente no banco para evitar execução concorrente.
3. Executar tarefas agendadas com tentativas progressivas e fila de falhas definitivas.
4. O CRM agora envia eventos internos explícitos de criação de follow-up após confirmar o salvamento; eventos nunca são inferidos de snapshots completos.
5. Integrar WhatsApp Business Platform oficial com modelo aprovado e webhook de status.
6. Enviar convite de avaliação somente após atendimento concluído, com consentimento, telefone e link HTTPS validado.
7. Validar primeiro com testes automatizados, fixtures sintéticas e mocks locais; não ativar integrações externas nesta etapa.

## Regras de segurança
- Não conceder permissões a `anon` ou `authenticated`.
- Segredos somente em variáveis de ambiente do servidor.
- `AUTOMATIONS_ENABLED` ausente ou `false` durante testes.
- Na etapa Meta, `WHATSAPP_TEST_MODE=true` é obrigatório e `WHATSAPP_TEST_RECIPIENTS` limita o envio aos números de teste expressamente permitidos. Se o modo não estiver ativo ou o destinatário não constar da lista, a função bloqueia a chamada antes da rede.
- Não aplicar migrações no projeto de produção nesta etapa.
- Confirmar suporte e limites de Scheduled Functions no plano Netlify.

## Limitações que precisam ser resolvidas antes da produção
- O adaptador aceita `lead_follow_up_requested` (`sourceType=task`) e `service_completed` (`sourceType=attendance`). Para `service_completed`, o servidor ignora dados de contato enviados pelo navegador e consulta `crm_app_state` para confirmar atendimento concluído, consentimento registrado, telefone válido e URL HTTPS antes de enfileirar. A chave única por atendimento evita duplicação. O worker repete a validação no estado persistido imediatamente antes do envio e cancela a tarefa se consentimento, telefone, status ou URL tiverem mudado. `appointment_completed` continua rejeitado.
- Validar o modelo WhatsApp aprovado e seus parâmetros.
- Nesta etapa, testar a integração Meta somente por mocks e simulações. Não utilizar `crm-automacao-teste`, não criar projeto substituto e não executar chamadas reais sem autorização específica.
- O primeiro envio real de validação será uma mensagem de teste ao número controlado pelo operador, não a clientes. A resposta HTTP da Meta indica aceitação; a confirmação de entrega deve chegar ao webhook.
- Nunca colar tokens, App Secret, verify token ou service-role key no chat, issues, commits ou logs.
- Implementar webhook autenticado de status da Meta para confirmar sent/delivered/read/failed; até lá, aceite da API não significa entrega.
- Respostas de rede ambíguas são marcadas `delivery_unknown` e exigem reconciliação manual antes de qualquer reenvio.
- Validar o link oficial de avaliação Google.

## Plano de ativação proposto (não autorizado ainda)
1. **Fase A — interno:** executar tarefas internas somente com mocks, fixtures sintéticas e testes automatizados; comparar fila simulada, logs e estado esperado.
2. **Fase B — integração simulada:** testar contratos de API com mocks; sem chamadas externas ou mensagens reais.
3. **Fase C — piloto controlado:** somente após autorização expressa separada, revisar arquitetura, número, modelo aprovado, consentimento, webhook de status e controles de pausa antes de qualquer envio.
4. **Fase D — expansão:** ampliar gradualmente com limites diários, alertas de falha, deduplicação e procedimento de pausa.

Critérios de avanço: CI verde; nenhum acesso público à fila; taxa de falhas explicada; entrega reconciliada via webhook; duplicatas e timeouts tratados; rollback documentado.
- Testar login, leads, tarefas, vendas, registros de atendimento, migração de cache antigo e persistência do CRM atual.
- Validar no ambiente isolado um modelo WhatsApp aprovado e seus parâmetros exatos; não usar clientes reais durante esse teste. Para o evento de avaliação, o código envia dois parâmetros de corpo na ordem: primeiro nome do cliente e URL HTTPS de avaliação; o modelo aprovado precisa corresponder a essa estrutura.


## Integração de eventos e confirmação de entrega — testes da branch isolada

- Criar um follow-up no CRM gera um evento explícito `lead_follow_up_requested`, com canal `internal`; esse fluxo não manda WhatsApp.
- Salvar um atendimento como `Concluído` com consentimento marcado gera um candidato `service_completed`. O servidor reconstrói destinatário e link a partir do estado persistido e não confia nos dados fornecidos pelo cliente.
- Antes de enviar um pedido de avaliação, o worker confere novamente consentimento e dados atuais no CRM. O envio continua condicionado a `AUTOMATIONS_ENABLED=true`, `WHATSAPP_TEST_MODE=true`, destinatário na allowlist e modelo aprovado compatível com os parâmetros configurados.
- O backend valida o tipo do evento, cria uma chave de deduplicação e chama `enqueue_crm_automation` com credencial exclusivamente do servidor, após confirmar a gravação do estado do CRM.
- A interface mantém eventos não aceitos para novas tentativas; a chave única no banco torna o reenvio idempotente.
- `whatsapp-status-webhook.mjs` valida o desafio GET e a assinatura HMAC SHA-256 de POST antes de atualizar o registro de tentativa associado ao ID da mensagem.
- Testes de integração usam respostas HTTP simuladas e dados fictícios; nenhum cliente ou API da Meta recebe mensagens.
- Nova migração proposta `202610100003_whatsapp_status.sql` adiciona status do provedor e metadados de erro. Ela ainda não foi aplicada em qualquer banco.
- A confirmação real de entrega exige configuração da URL do webhook e segredo da Meta apenas em ambiente de teste; os testes do CI validam o contrato com assinatura/chaves fictícias, não a conexão real com a Meta.


## Pré-requisitos para qualquer futura validação externa da Meta (não autorizada nesta etapa)

Nenhuma chamada real à API da Meta deve ser executada durante esta fase. Usar mocks e testes automatizados com credenciais fictícias.

Antes de uma futura validação externa, exigir autorização expressa para o escopo exato, confirmar que o número pertence ao operador e que o modelo está aprovado, validar webhook e assinatura, e documentar o procedimento de pausa e reconciliação. Não usar `crm-automacao-teste`, não criar projeto substituto, não transferir segredos ou dados entre projetos e não configurar variáveis de produção para testes.

**Bloqueio atual:** a conexão real com a Meta não foi comprovada nesta auditoria. Não foram enviados mensagens nem alteradas configurações de Meta, Netlify ou Supabase.
 
## Escopo funcional confirmado após auditoria do CRM

- O modelo de estado atualmente usado pela interface contém `leads`, `tasks` e `sales`. O CRM não expõe ainda uma coleção estruturada de agendamentos/atendimentos concluídos que permita reconciliar, com segurança, os eventos `appointment_completed` e `service_completed`.
- Por isso, o adaptador agora aceita somente `lead_follow_up_requested` com `sourceType=task`. Tentativas de enfileirar eventos de agendamento ou serviço concluído são rejeitadas antes de qualquer chamada à fila.
- O worker confirma um follow-up somente depois de encontrar o ID da tarefa no estado persistido; se não encontrar, envia para `dead_letter` para análise, sem criar tarefas duplicadas.
- O evento de follow-up é interno e não envia mensagens. O worker e os envios externos permanecem desativados até validação separada.
- Próximo trabalho funcional: modelar no CRM um registro explícito de atendimento concluído (identificador estável, cliente/lead, serviço, data/hora, status e evidência de consentimento para contato). Somente depois disso deve ser conectado o pedido de avaliação, com URL oficial validada, telefone válido e webhook de status da Meta.
