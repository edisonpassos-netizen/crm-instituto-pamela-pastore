# Auditoria de autenticação, permissões e prontidão do banco

**Projeto:** CRM Instituto Pâmela Pastore  
**Branch auditada:** `feature/automation-engine`  
**Supabase oficial:** `studio-pamela-aluno` (`pposribyzhxyupbxrpfo`)  
**Estado:** proposta técnica para aprovação. Nenhuma migração foi aplicada e nenhum deploy foi realizado.

## 1. Resultado executivo

A auditoria encontrou controles úteis já existentes, mas a segurança ainda não deve ser considerada pronta para produção. Os bloqueios são: autenticação baseada em senha compartilhada sem limitação de tentativas; privilégios de tabela excessivos concedidos a `authenticated`; ACLs padrão permissivas para objetos futuros; e ausência das tabelas persistentes da fila de automação no projeto oficial.

## 2. Autenticação e sessão — achados

### Controles positivos observados no código

- A função `crm-state` exige sessão válida antes de ler ou atualizar `crm_app_state`.
- A sessão é assinada com HMAC-SHA-256, expira após 8 horas e é verificada com comparação de tempo constante.
- O cookie é `HttpOnly; Secure; SameSite=Strict`.
- A senha e o segredo da sessão são lidos do ambiente do servidor, não do HTML.
- O servidor valida a origem e recusa gravações sem origem válida.
- A chave de servidor do Supabase não é enviada ao navegador.
- O endpoint de estado usa revisão otimista para evitar sobrescrita concorrente.

### Bloqueios antes da produção

1. **Senha compartilhada:** `CRM_LOGIN_PASSWORD` autentica todos os operadores como uma identidade única. Não permite revogação individual, trilha de auditoria por pessoa ou autorização por perfil.
2. **Sem limitação persistente de tentativas:** o caminho de login não implementa rate limiting/lockout persistente. Comparação de tempo constante não impede tentativas repetidas.
3. **Sem proteção de identidade por usuário:** a sessão contém expiração e nonce, mas não uma identidade/role do operador; não há RBAC efetivo nesta camada.
4. **Logout:** limpa o cookie no navegador, mas não mantém lista de sessões revogadas no servidor. A sessão anterior permanece válida até expirar se o token tiver sido copiado.
5. **CSRF/origem:** a validação de Origin e SameSite Strict são controles positivos; não devem ser considerados substitutos de autenticação. Manter validação estrita de métodos e origens.
6. **Preferência de acesso direto:** não remover a barreira de autenticação para obter acesso sem tela de login. A solução deve ser uma sessão segura persistente/SSO ou Supabase Auth com UX simples, sem tornar os dados públicos.

**Decisão recomendada para aprovação:** substituir a senha compartilhada por identidade individual (Supabase Auth ou SSO equivalente), mapear identidade para papéis de menor privilégio, acrescentar limitação de tentativas e trilha de auditoria. Manter a sessão persistente para reduzir logins repetidos, sem eliminar a autenticação. Não alterar esse fluxo sem testes de regressão e aprovação do desenho.

## 3. Auditoria de permissões do Supabase oficial

Consultas somente de leitura em 12/10/2026 confirmaram:

- `crm_app_state`, `crm_automation_rules` e `crm_automation_runs` têm RLS habilitado.
- `crm_app_state` tem política explícita de negação para `anon` e `authenticated`; o backend acessa a tabela por `service_role`.
- `crm_automation_rules` e `crm_automation_runs` têm RLS habilitado sem políticas. A API não deve depender de acesso direto a essas tabelas.
- Os dois objetos de automação legados ainda concedem privilégios diretos a `authenticated`, incluindo `TRUNCATE`, `TRIGGER`, `REFERENCES` e `MAINTAIN` na ACL observada. RLS não é uma proteção suficiente para esses privilégios de tabela.
- A ACL padrão de `public` para objetos criados pelo papel `postgres` concede privilégios amplos a `authenticated` em tabelas, sequências e funções futuras. A ACL padrão registrada para `supabase_admin` também inclui `anon` e `authenticated`; esta proposta não altera ACLs padrão de papéis gerenciados pelo provedor.
- O papel `service_role` tem `BYPASSRLS`, comportamento esperado para a chave de servidor; por isso, essa chave deve permanecer exclusivamente em funções de servidor.
- Os advisors do Supabase reportam 10 tabelas com RLS habilitado e sem políticas, incluindo tabelas financeiras/clínicas e as tabelas de automação, além de proteção contra senhas comprometidas desativada no Supabase Auth. A ausência de política normalmente bloqueia acesso via API, mas precisa ser revisada por tabela para confirmar se é intencional.

## 4. Plano de migração proposto

Ordem pretendida, sempre após aprovação explícita:

1. `202610120001_automation_engine.sql`: cria fila e histórico de tentativas; inclui deduplicação e função de claim atômico.
2. `202610120002_delivery_unknown.sql`: adiciona estado de resultado ambíguo para impedir reenvio automático após timeout incerto.
3. `202610120003_whatsapp_status.sql`: adiciona campos para recibos de status do provedor.
4. `202610120004_harden_automation_privileges.sql`: remove privilégios de manutenção excedentes das tabelas públicas para `anon`/`authenticated`, revoga acesso direto aos objetos legados de automação, limita fila/tentativas e RPCs a `service_role`, e revoga ACLs padrão amplas de objetos futuros criados por `postgres`.

### Compatibilidade e risco

- O histórico do banco tem 13 migrações e a última versão registrada é `20261010133404`. As três tabelas de fila/tentativas não existem; as três primeiras migrações propostas não aparecem no histórico oficial.
- O versionamento `20261012...` é posterior ao histórico observado. Antes de execução, confirmar novamente histórico e ausência de colisão.
- A quarta migração é deliberadamente restrita a privilégios; não altera linhas de negócio nem apaga tabelas.
- A revogação de ACLs padrão de `postgres` exige que futuras tabelas/funções recebam grants explícitos conforme a necessidade. Isso é intencional, mas deve ser incluído no checklist de futuras migrações.
- A ACL padrão de `supabase_admin` permanece como achado separado, pois alterar padrões de um papel gerenciado pelo provedor requer validação de ownership/membership e impacto. Não executar tentativa especulativa.
- A migração percorre tabelas atuais de `public` para revogar apenas `TRUNCATE`, `REFERENCES`, `TRIGGER` e, em PostgreSQL 17+, `MAINTAIN`; não remove os privilégios DML governados por políticas RLS nas tabelas de negócio.

## 5. Plano de backup, rollback e recuperação

### Antes da migração

1. Confirmar janela de manutenção e autorização por escrito.
2. Exportar backup lógico/snapshot consistente do projeto oficial e verificar que o backup pode ser restaurado; registrar timestamp, versão e responsável.
3. Salvar o histórico de migrações, grants, ACLs padrão, políticas RLS, definições de funções e contagens de linhas das tabelas envolvidas.
4. Confirmar `AUTOMATIONS_ENABLED=false`; manter qualquer envio externo desativado.
5. Confirmar que a branch/commit revisado é o que será aprovado; não publicar automaticamente.

### Durante e imediatamente depois

1. Aplicar uma migração por vez, com `ON_ERROR_STOP`/transação e interromper diante de qualquer erro.
2. Verificar tabelas/colunas/constraints, funções, grants, RLS e políticas.
3. Executar testes negativos: `anon` e `authenticated` não podem ler/escrever fila/tentativas nem executar RPCs privilegiadas; `service_role` mantém apenas os privilégios necessários.
4. Confirmar que o CRM atual ainda lê/grava o snapshot via função de servidor e que a revisão otimista funciona.
5. Conferir que não houve alterações em dados de negócio e manter automações desligadas.

### Rollback de aplicação

- Desativar o worker e manter `AUTOMATIONS_ENABLED=false`.
- Reverter o código para a versão aprovada anterior e não fazer deploy automático.
- Preservar fila, tentativas e estados de entrega; não apagar tabelas nem jobs por padrão.
- Não reintroduzir automaticamente privilégios amplos de `authenticated` para resolver uma falha. Corrigir com grants específicos e mínimos.
- Se a migração de schema precisar ser revertida, preparar uma migração compensatória separada após confirmar que a fila não contém trabalho pendente e que os dados foram exportados. Não executar `DROP TABLE` como rollback de rotina.
- Para ACLs padrão, preferir correção forward e grants explícitos. Restaurar permissões padrão amplas só com análise de impacto e aprovação separada.

## 6. Critérios de aprovação

- [ ] Desenho de autenticação individual aprovado; rate limiting e auditoria de login especificados.
- [ ] Grants excedentes revisados e plano de aplicação aprovado.
- [ ] ACLs padrão de `postgres` documentadas e estratégia de grants explícitos aceita.
- [ ] RLS sem políticas revisado individualmente, especialmente dados clínicos/financeiros.
- [ ] Backup e recuperação testados.
- [ ] Quatro migrações executadas com sucesso em PostgreSQL efêmero e testes de privilégios aprovados.
- [ ] Testes de regressão de sessão, logout, leitura/gravação e concorrência aprovados.
- [ ] Plano de rollback e critérios de interrupção aceitos.
- [ ] Aprovação explícita separada para qualquer migração no Supabase oficial e para qualquer deploy no Netlify.

## 7. Limites desta entrega

Esta é uma proposta de prontidão para revisão. Nenhuma migração foi aplicada ao Supabase oficial, nenhum privilégio foi alterado em produção, nenhum deploy foi criado e nenhuma mensagem externa foi enviada. O ambiente `crm-automacao-teste` não foi utilizado.
