# Implantação parcial — 23/10/2026

## Problema corrigido
O webhook armazenava mensagens, mas não criava leads no funil. A nova captura transacional é restrita a um Phone Number ID explicitamente permitido, desligada por padrão. A tela de conversas usa a sessão existente, evita HTML de mensagens e permite atendimento manual pelo WhatsApp.

## Validação
- 109 testes JavaScript aprovados localmente antes desta revisão.
- Nova RPC testada no PostgreSQL com rollback: criação, deduplicação, contato repetido, telefone inválido e privilégios.
- Consulta após testes: revisão 42, cinco leads e 11 mensagens preservados; nenhum job ativo.
- Advisors de segurança/performance sem alertas.
- Migração aplicada: 20261023144838_atomic_whatsapp_lead_capture.
- Nenhuma mensagem enviada e nenhuma alteração de campanha/Agenda/telefone da recepção.

## Dependências externas ainda abertas
Kapso, projeto 384f5bee-528a-4732-a342-a545e8be0939: zero números comerciais conectados, apenas sandbox. O fluxo de coexistência exige celular com WhatsApp Business e autorização Meta. Netlify segue com remetente de teste 1275845688956327, outbound=test, produção=false. Atendimento por IA ainda não implementado/homologado; esta alteração não certifica operação autônoma.

Não ativar captura para o remetente de teste nem enviar a clientes para simular homologação. Confirmar o Phone Number ID do número pessoal após conexão, integrar o webhook/provedor correto e testar o fluxo controlado.
