# CRM — Instituto Pâmela Pastore

Repositório do CRM publicado no Netlify, com persistência no Supabase.

## Estrutura
- `index.html`: interface do CRM.
- `netlify/functions/crm-state.mjs`: API de leitura/gravação do estado do CRM.
- `netlify.toml`: configuração de build e funções.
- `supabase/migrations/202610090001_create_crm_app_state.sql`: migration para o estado do CRM.

## Variáveis no Netlify
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secreta; nunca colocar no repositório ou no navegador)
- `CRM_ALLOWED_ORIGIN`

## Segurança
A validação de Origin/CORS não é autenticação. A função atual não deve ser usada com dados reais de clientes até ser adicionada autenticação/autorização real. Nunca publique credenciais no GitHub.

## Deploy
A raiz do site é o diretório do projeto; a função deve ser publicada a partir de `netlify/functions/`. O arquivo `.github/workflows/import-netlify-page.yml` permite importar a página atualmente publicada no Netlify para o repositório manualmente por Actions.
