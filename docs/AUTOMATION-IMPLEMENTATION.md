# Implementação gradual das automações

Branch isolada: `feature/automation-engine`.

Nenhuma migração foi aplicada ao Supabase de produção. O worker deve permanecer desativado até aprovação explícita e testes em banco isolado.

## Etapas
1. Criar fila persistente com chave de deduplicação e log por tentativa.
2. Reivindicar tarefas atomicamente no banco para evitar execução concorrente.
3. Executar tarefas agendadas com tentativas progressivas e fila de falhas definitivas.
4. Conectar o adaptador de eventos testado ao fluxo de gravação real do CRM. A integração ainda não está conectada: o CRM atual salva um estado JSON agregado, então não se deve inferir eventos confiáveis a partir de snapshots inteiros.
5. Integrar WhatsApp Business Platform oficial com modelo aprovado e webhook de status.
6. Enviar convite de avaliação somente após atendimento concluído, com consentimento, telefone e link HTTPS validado.
7. Testar isoladamente antes de qualquer ativação.

## Regras de segurança
- Não conceder permissões a `anon` ou `authenticated`.
- Segredos somente em variáveis de ambiente do servidor.
- `AUTOMATIONS_ENABLED` ausente ou `false` durante testes.
- Não aplicar migrações no projeto de produção nesta etapa.
- Confirmar suporte e limites de Scheduled Functions no plano Netlify.

## Limitações que precisam ser resolvidas antes da produção
- Conectar eventos reais do CRM à fila.
- Validar o modelo WhatsApp aprovado e seus parâmetros.
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
