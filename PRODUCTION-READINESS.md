# Production Readiness — CRM Instituto Pâmela Pastore

Atualizado em 17/10/2026.

## Conferência de 17/10/2026

- A publicação de produção está sincronizada com o HEAD validado de `main`; a Central Operacional e os dois workers agendados estão incluídos.
- Os dois workflows do commit publicado terminaram com sucesso.
- A conferência somente de leitura no banco exclusivo do CRM confirmou RLS nas tabelas públicas e ausência de SELECT para `anon` e `authenticated`.
- As configurações consultadas mantêm automações externas e produção do WhatsApp desligadas. Não houve envio de mensagem nesta conferência.
- Há quatro registros históricos em `dead_letter`: três follow-ups internos por telefone ausente ou inválido e um teste de homologação WhatsApp. Preservar o histórico; corrigir os cadastros com dados confirmados antes de resolver ou reagendar os follow-ups.
- Não há experiências registradas nem jobs externos pendentes, em processamento ou retry nessa consulta. Isso não substitui homologação de ponta a ponta.
- Os dois templates oficiais foram aprovados pela Meta em 17/10/2026, conforme confirmação do usuário.
- A CI de integração prova que o claim interno não captura jobs WhatsApp ou Google; o job de unidade inclui isolamento do banco e reconciliador.

Esta conferência não altera cadastros, filas, credenciais ou a Agenda Pilates. Após qualquer novo commit, comparar novamente o HEAD e a publicação antes de homologar produção.

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

## Templates Meta aprovados

- `pesquisa_experiencia_pos_atendimento_v1` — `pt_BR` — aprovado.
  - respostas: Excelente / Boa / Poderia melhorar;
  - payloads: `experience_very_good`, `experience_good`, `experience_needs_improvement`.
- `avaliacao_google_pos_atendimento_v1` — `pt_BR` — aprovado.

O backend deve usar os nomes exatos aprovados pela Meta. Se a Meta alterar categoria, nome, idioma ou componentes no futuro, revisar configuração e testes antes de qualquer ativação.

## Sincronização GitHub → Netlify

- `main` contém as correções mais recentes e a Central Operacional.
- A publicação Netlify deve sempre ser comparada pelo `commit_ref` com o HEAD atual de `main` antes de qualquer homologação.
- Enquanto o Netlify estiver em commit anterior ao HEAD do GitHub, considerar produção desatualizada e não iniciar homologação oficial.
- Após sincronizar, validar quantidade de Functions, agendamentos dos workers, secret scan e ausência de HTTP 5xx.

## Onboarding do número oficial

A documentação oficial atual da WhatsApp Business Platform confirma que o uso da Cloud API exige WABA, número comercial, registro do número e obtenção do Phone Number ID. O processo de registro pode alterar o estado operacional do número. Portanto:

- não registrar, migrar, desregistrar ou substituir o número oficial enquanto o WhatsApp Business atual estiver em uso diário sem validar o caminho de onboarding aplicável à conta;
- confirmar a modalidade vigente de coexistência/onboarding na documentação Meta aplicável à conta antes do cutover;
- manter `WHATSAPP_OUTBOUND_MODE=disabled` e `WHATSAPP_PRODUCTION_ENABLED=false` mesmo após obter o Phone Number ID, até a homologação controlada;
- qualquer teste com o remetente oficial deve usar números internos autorizados e possuir plano de retorno ao modo fail-closed.

## Bloqueadores para go-live

1. Estratégia oficial de coexistência/onboarding para o número +55 15 99673-4292 confirmada no fluxo aplicável à conta.
2. Phone Number ID oficial obtido sem interromper o WhatsApp Business em uso diário.
3. Homologação controlada com números internos.
4. Webhook/status/inbound comprovados com o remetente oficial.
5. Validação de ponta a ponta: atendimento concluído → pesquisa → resposta → recuperação ou convite neutro.
6. Rotação/armazenamento seguro de credenciais que não estejam marcadas como segredo.
7. Repositório tornado privado e branch principal protegida, quando a administração do GitHub permitir.
8. Backup recente e procedimento de rollback conferidos antes da ativação.

## Sequência de homologação futura

1. Confirmar Netlify no mesmo commit validado de `main`.
2. Conferir nomes/idiomas/componentes aprovados sem editar produção.
3. Confirmar documentação/fluxo Meta vigente para onboarding do número oficial.
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
- saúde do `automation-worker` e do `followup-reconciler` agendados;
- revisão do estado principal após operações concorrentes.

## Itens explicitamente fora de escopo automático neste momento

- migrar/registrar o número oficial;
- enviar mensagens para clientes reais;
- submeter App Review;
- trocar credenciais críticas sem rollback;
- tornar repositório privado/proteger branch sem permissão administrativa;
- apagar dados reais, filas ou histórico.
