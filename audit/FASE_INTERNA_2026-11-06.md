# Fase interna do CRM — 6 de novembro de 2026

## Alterações desta fase

- Importação preserva indicadores de comparecimento e fechamento de plano, reconhecendo `Foi na Aula?` e `lead_status`.
- Campos ausentes ou vazios na planilha não apagam dados existentes. Respostas explícitas Sim/Não continuam atualizando os indicadores.
- Telefones brasileiros locais e com prefixo 55 são comparados de forma equivalente. Pessoas com o mesmo nome e telefones diferentes permanecem separadas. Vários registros existentes para o mesmo telefone são sinalizados como ambíguos e ignorados.
- CSV aceita vírgula ou ponto e vírgula, BOM, campos entre aspas, aspas duplicadas e quebras de linha em comentários. Cabeçalhos repetidos, colunas excedentes e aspas incompletas são rejeitados antes da importação.
- A central operacional oferece acesso às conversas e às tarefas específicas. Falhas de atualização removem números antigos; sessão expirada volta ao login. O horário da consulta aparece em São Paulo.
- O histórico de conversas inclui mensagens recebidas e respostas e remove resultados antigos quando uma atualização falha.

## Validação

- 128 testes JavaScript locais aprovados, incluindo 13 regressões novas para importação e atualização das telas.
- Testes utilizam dados sintéticos e rede simulada. Não certificam o recebimento real pelo número comercial, nem substituem a CI e a validação da publicação.
- Nenhum cadastro, histórico, fila, credencial ou configuração de envio de produção foi alterado por estas correções.

## Pendências externas e limite da pausa

- A verificação empresarial da Meta consta como Em análise; o botão Publicar permanece desativado na conferência de 6/11.
- O aplicativo consultado tem zero números comerciais e um número de teste. O callback do CRM está configurado e messages está assinado; standby e a visibilidade em espera ainda precisam ser concluídos no fluxo autorizado.
- Após a liberação aplicável: confirmar o número comercial e o vínculo ao app, concluir encaminhamento e validar com contato interno o recebimento, resposta, histórico e deduplicação.
- Não enviar mensagens a clientes nem habilitar novas automações sem autorização.
- Não reimportar dados reais automaticamente para corrigir importações antigas. As correções alteram o comportamento das próximas importações.
- Funcionalidades históricas ainda não homologadas, como recuperação automática de rascunhos offline e atendimento de IA completo, não são declaradas concluídas por esta fase.

O resultado da CI, o PR e o deploy devem ser consultados no GitHub/Netlify; este registro não presume publicação antes de sua confirmação.
