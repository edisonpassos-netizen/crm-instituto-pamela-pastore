# Production Readiness — CRM Instituto Pâmela Pastore

Atualizado em 16/10/2026.

## Estado operacional seguro

Até a homologação final do número oficial, o ambiente deve permanecer fail-closed:

- `INTERNAL_AUTOMATIONS_ENABLED=true`
- `AUTOMATIONS_ENABLED=false`
- `CUSTOMER_EXPERIENCE_ENABLED=false`
- `WHATSAPP_TEST_MODE=false`
- `WHATSAPP_OUTBOUND_MODE=disabled`
- `WHATSAPP_PRODUCTION_ENABLED=false`
- `WHATSAPP_PRODUCTION_PHONE_NUMBER_ID` não deve ser configurado antes da homologação segura do número oficial.

Nenhuma etapa deste documento autoriza migração do número oficial, envio real, App Review, troca de credenciais críticas ou ativação de produção.

## Pré-requisitos técnicos já implementados

- Banco exclusivo do CRM: `dxfzuxybubvnjertiowf`.
- Rejeição fail-closed de qualquer outro projeto Supabase.
- RLS e privilégios restritos para tabelas/RPCs de automação.
- Sessão assinada e origem permitida no backend.
- Concorrência por revisão no estado principal.
- Trava contra zeragem acidental de todo o estado comercial.
- Fila com deduplicação, claim atômico, retry e recuperação de locks abandonados.
- `delivery_unknown` para resultado ambíguo; sem reenvio automático.
- Webhook Meta com validação HMAC, deduplicação inbound e persistência de status.
- Fluxo de experiência, recuperação e convite neutro ao Google.
- Follow-ups novos do CRM principal enfileirados transacionalmente em canal interno.
- Rota `/atendimentos` para registrar conclusão real e autorização explícita de acompanhamento.
- CI em Node 24 e PostgreSQL 16 efêmero.
- CSP, HSTS, anti-framing e demais headers de segurança do frontend.

## Templates aguardando Meta

- `pesquisa_experiencia_pos_atendimento_v1` — `pt_BR` — em análise.
  - respostas: Excelente / Boa / Poderia melhorar;
  - payloads: `experience_very_good`, `experience_good`, `experience_needs_improvement`.
- `avaliacao_google_pos_atendimento_v1` — `pt_BR` — em análise.

O backend deve usar os nomes exatos aprovados pela Meta. Se a Meta alterar categoria, nome, idioma ou componentes, revisar configuração e testes antes de qualquer ativação.

## Bloqueadores para go-live

1. Templates Meta aprovados.
2. Estratégia oficial de coexistência/onboarding para o número +55 15 99673-4292 confirmada com documentação Meta vigente.
3. Phone Number ID oficial obtido sem interromper o WhatsApp Business em uso diário.
4. Homologação controlada com números internos.
5. Webhook/status/inbound comprovados com o remetente oficial.
6. Validação de ponta a ponta: atendimento concluído → pesquisa → resposta → recuperação ou convite neutro.
7. Rotação/armazenamento seguro de credenciais que não estejam marcadas como segredo.
8. Repositório tornado privado e branch principal protegida, quando a administração do GitHub permitir.
9. Backup recente e procedimento de rollback conferidos antes da ativação.

## Sequência de homologação futura

1. Confirmar status aprovado dos dois templates.
2. Conferir nomes/idiomas/componentes aprovados sem editar produção.
3. Pesquisar documentação oficial Meta vigente sobre coexistência do WhatsApp Business App e Cloud API.
4. Preparar onboarding do número oficial sem executar cutover destrutivo.
5. Obter Phone Number ID oficial.
6. Configurar ID oficial mantendo `WHATSAPP_OUTBOUND_MODE=disabled` e `WHATSAPP_PRODUCTION_ENABLED=false`.
7. Fazer teste de webhook e configuração sem outbound real.
8. Autorizar janela de homologação com números internos.
9. Habilitar somente o mínimo necessário para um teste controlado.
10. Validar provider message id, status `sent/delivered/read`, inbound e deduplicação.
11. Restaurar travas se qualquer etapa for ambígua.
12. Só depois planejar ativação gradual para clientes reais.

## Critérios de rollback

Interromper ativação e retornar imediatamente ao modo fail-closed se ocorrer qualquer um destes casos:

- interrupção ou risco de interrupção do WhatsApp oficial;
- divergência do Phone Number ID;
- template rejeitado/pausado/desabilitado;
- respostas HTTP 401/403 persistentes da Meta;
- aumento de `dead_letter` ou `delivery_unknown` sem causa identificada;
- webhook sem assinatura válida ou sem persistência;
- duplicação de mensagem ou de pesquisa;
- fila externa processando enquanto alguma flag de produção deveria estar desligada;
- divergência de dados entre estado principal e fila.

Rollback lógico mínimo:

- `WHATSAPP_OUTBOUND_MODE=disabled`
- `WHATSAPP_PRODUCTION_ENABLED=false`
- `AUTOMATIONS_ENABLED=false`
- `CUSTOMER_EXPERIENCE_ENABLED=false`

Não excluir filas, tentativas, mensagens, experiências ou logs durante rollback; preservar evidências para diagnóstico.

## Monitoramento pós-ativação

Nas primeiras horas/dias de produção, acompanhar pelo menos:

- jobs `pending`, `processing`, `retry`, `dead_letter`, `delivery_unknown`;
- tempo desde criação até processamento;
- tentativas por job;
- provider status `sent/delivered/read/failed`;
- mensagens inbound duplicadas;
- pesquisas pendentes sem resposta;
- recuperações aguardando operador;
- convites de avaliação preparados/enviados;
- HTTP 4xx/5xx das Netlify Functions;
- saúde do worker agendado;
- revisão do estado principal após operações concorrentes.

## Itens explicitamente fora de escopo automático neste momento

- migrar/registrar o número oficial;
- enviar mensagens para clientes reais;
- submeter App Review;
- trocar credenciais críticas sem rollback;
- tornar repositório privado/proteger branch sem permissão administrativa;
- apagar dados reais, filas ou histórico.
