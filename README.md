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
