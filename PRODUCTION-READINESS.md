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
- Novos follow-ups do CRM principal são enfileirados atomicamente pelo banco na mesma transação que persiste o estado, sempre em canal interno e com validação da origem.
- `followup-reconciler` funciona como backstop idempotente para follow-ups legados/abertos que eventualmente não possuam fila, sem envio externo.
- Rota `/atendimentos` para registrar conclusão real e autorização explícita de acompanhamento.
- Rota `/operacao` para acompanhar estado do CRM, atendimentos e itens aguardando operador sem expor segredos nem enviar mensagens.
- CI em Node 24 e PostgreSQL 16 efêmero.
- CSP, HSTS, anti-framing e demais headers de segurança do frontend.

## Templates aguardando Meta

- `pesquisa_experiencia_pos_atendimento_v1` — `pt_BR` — em análise.
  - respostas: Excelente / Boa / Poderia melhorar;
  - payloads: `experience_very_good`, `experience_good`, `experience_needs_improvement`.
- `avaliacao_google_pos_atendimento_v1` — `pt_BR` — em análise.

O backend deve usar os nomes exatos aprovados pela Meta. Se a Meta alterar categoria, nome, idioma ou componentes, revisar configuração e testes antes de qualquer ativação.

## Sincronização GitHub → Netlify

- `main` contém as correções mais recentes e a Central Operacional.
- A publicação Netlify deve sempre ser comparada pelo `commit_ref` com o HEAD atual de `main` antes de qualquer homologação.
- Enquanto o Netlify estiver em commit anterior ao HEAD do GitHub, considerar produção **desatualizada** e não iniciar homologação oficial.
- Após sincronizar, validar quantidade de Functions, agendamentos dos workers, secret scan e ausência de HTTP 5xx.

## Onboarding do número oficial

A documentação oficial atual da WhatsApp Business Platform confirma que o uso da Cloud API exige WABA, número comercial, registro do número e obtenção do Phone Number ID. O processo de registro pode alterar o estado operacional do número. Portanto:

- não registrar, migrar, desregistrar ou substituir o número oficial enquanto o WhatsApp Business atual estiver em uso diário;
- confirmar a modalidade vigente de coexistência/onboarding na documentação Meta aplicável à conta antes do cutover;
- manter `WHATSAPP_OUTBOUND_MODE=disabled` e `WHATSAPP_PRODUCTION_ENABLED=false` mesmo após obter o Phone Number ID, até a homologação controlada;
- qualquer teste com o remetente oficial deve usar números internos autorizados e possuir plano de retorno ao modo fail-closed.

## Bloqueadores para go-live

1. Netlify sincronizado com o HEAD validado de `main`.
2. Templates Meta aprovados.
3. Estratégia oficial de coexistência/onboarding para o número +55 15 99673-4292 confirmada com documentação Meta vigente.
4. Phone Number ID oficial obtido sem interromper o WhatsApp Business em uso diário.
5. Homologação controlada com números internos.
6. Webhook/status/inbound comprovados com o remetente oficial.
7. Validação de ponta a ponta: atendimento concluído → pesquisa → resposta → recuperação ou convite neutro.
8. Rotação/armazenamento seguro de credenciais que não estejam marcadas como segredo.
9. Repositório tornado privado e branch principal protegida, quando a administração do GitHub permitir.
10. Backup recente e procedimento de rollback conferidos antes da ativação.

## Sequência de homologação futura

1. Confirmar Netlify no mesmo commit validado de `main`.
2. Confirmar status aprovado dos dois templates.
3. Conferir nomes/idiomas/componentes aprovados sem editar produção.
4. Pesquisar documentação oficial Meta vigente sobre coexistência do WhatsApp Business App e Cloud API.
5. Preparar onboarding do número oficial sem executar cutover destrutivo.
6. Obter Phone Number ID oficial.
7. Configurar ID oficial mantendo `WHATSAPP_OUTBOUND_MODE=disabled` e `WHATSAPP_PRODUCTION_ENABLED=false`.
8. Fazer teste de webhook e configuração sem outbound real.
9. Autorizar janela de homologação com números internos.
10. Habilitar somente o mínimo necessário para um teste controlado.
11. Validar provider message id, status `sent/delivered/read`, inbound e deduplicação.
12. Restaurar travas se qualquer etapa for ambígua.
13. Só depois planejar ativação gradual para clientes reais.

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
- saúde do `automation-worker` e do `followup-reconciler` agendados;
- revisão do estado principal após operações concorrentes.

## Itens explicitamente fora de escopo automático neste momento

- migrar/registrar o número oficial;
- enviar mensagens para clientes reais;
- submeter App Review;
- trocar credenciais críticas sem rollback;
- tornar repositório privado/proteger branch sem permissão administrativa;
- apagar dados reais, filas ou histórico.
