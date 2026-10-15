# CRM — Instituto Pâmela Pastore

Repositório do CRM publicado no Netlify, com persistência no Supabase.

## Estrutura
- `index.html`: interface do CRM e tela de acesso.
- `netlify/functions/crm-state.mjs`: API de leitura/gravação e autenticação por sessão.
- `netlify.toml`: configuração de build e funções.
- `supabase/migrations/202610090001_create_crm_app_state.sql`: migration de referência para a tabela de estado.

## Variáveis obrigatórias no Netlify
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — secreta; nunca colocar no repositório ou no navegador.
- `CRM_ALLOWED_ORIGIN` — por exemplo, `https://peppy-salamander-2d8776.netlify.app`.
- `CRM_LOGIN_PASSWORD` — senha de acesso ao CRM, com pelo menos 12 caracteres.
- `CRM_SESSION_SECRET` — segredo aleatório com pelo menos 32 caracteres para assinar sessões.

Não use o mesmo valor para a senha e o segredo de sessão. Configure todos os valores secretos diretamente no painel do Netlify. Não os publique no GitHub nem os envie por chat.

## Autenticação
A função exige uma sessão assinada, armazenada em cookie `HttpOnly; Secure; SameSite=Strict` com validade de 8 horas. A origem/CORS é uma camada adicional e não substitui autenticação.

## Deploy
A raiz do site é o diretório do projeto; a função deve ser publicada a partir de `netlify/functions/`. O workflow `.github/workflows/import-netlify-page.yml` importa a interface atual do site Netlify para o repositório quando executado manualmente.

## Antes de usar com dados reais
- Conectar este repositório ao site Netlify correto.
- Configurar todas as variáveis acima.
- Confirmar que o deploy publica a função.
- Testar login, leitura, gravação, edição e persistência após recarregar.
- Tornar o repositório privado, pois contém código proprietário do CRM.

## Banco exclusivo do CRM

Este CRM deve usar somente o projeto `crm-automation-test` (`dxfzuxybubvnjertiowf`), com `SUPABASE_URL=https://dxfzuxybubvnjertiowf.supabase.co` e uma chave de servidor desse mesmo projeto. A API rejeita URLs diferentes antes de enviar qualquer chamada ao banco. A Agenda Pilates permanece no projeto `studio-pamela-aluno`.

A variável `SUPABASE_SERVICE_ROLE_KEY` aceita uma chave moderna `sb_secret_` ou uma chave legada `service_role` do projeto do CRM. Chaves modernas são enviadas apenas no cabeçalho `apikey`; chaves legadas também usam `Authorization`. Nenhuma chave real deve ser incluída em arquivos de teste ou commits.

Execute `node --test tests/*.test.mjs` para conferir o destino, a rejeição de chaves de outro projeto, a autenticação e a proteção contra revisão desatualizada. Os testes HTTP usam respostas simuladas.

A troca em produção exige configurar a chave secreta do destino no Netlify, conferir a revisão final dos dados, atualizar a URL e publicar este código. Só depois de validar leitura e gravação no banco novo deve-se revogar a chave antiga usada pelo CRM no projeto da Agenda. Não revogue credenciais compartilhadas sem identificar seus outros consumidores.
