# Implementação gradual das automações

Branch isolada: `feature/automation-engine`.

Nenhuma migração foi aplicada ao Supabase de produção. O worker deve permanecer desativado até aprovação explícita e testes em banco isolado.

## Etapas
1. Criar fila persistente com chave de deduplicação e log por tentativa.
2. Reivindicar tarefas atomicamente no banco para evitar execução concorrente.
3. Executar tarefas agendadas com tentativas progressivas e fila de falhas definitivas.
4. Integrar os eventos reais do CRM à fila, sem inferir atendimento concluído por venda ou agendamento.
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
- Implementar webhook de status para confirmar entrega e tratar respostas ambíguas.
- Validar o link oficial de avaliação Google.
- Testar login, leads, tarefas, vendas e persistência do CRM atual.
