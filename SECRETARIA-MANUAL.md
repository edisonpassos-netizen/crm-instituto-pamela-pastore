# Manual da Secretaria — CRM Instituto Pâmela Pastore

Atualizado em 16/10/2026.

Este manual descreve a operação diária do CRM. Ele não substitui os procedimentos clínicos nem autoriza disparos de WhatsApp em produção.

## Acesso

Use o endereço oficial do CRM no Netlify e a senha fornecida pela administração. A mesma sessão autenticada permite acessar:

- `/` — CRM principal;
- `/followups` — fila operacional de retornos e recuperação de experiência;
- `/atendimentos` — registro e conclusão de atendimentos.

Se aparecer “sessão expirada”, faça login novamente. Não compartilhe senha em mensagens, planilhas ou anotações públicas.

## Cadastro de lead

No CRM principal, cadastre o lead com os dados necessários para identificação e contato. Antes de criar um retorno, confira principalmente:

- nome correto;
- telefone com DDD;
- origem/canal quando disponível;
- observações realmente necessárias ao atendimento.

O sistema valida o telefone antes de determinadas automações. Um número incorreto pode impedir o fluxo e gerar uma tarefa de correção em vez de contato.

## Criar follow-up solicitado pelo cliente

Acesse `/followups` e use **Novo follow-up solicitado**.

1. Selecione o lead.
2. Informe a data combinada.
3. Informe o horário combinado.
4. Selecione o tipo: WhatsApp, ligação, retorno, reativação ou outro.
5. Registre uma observação curta e objetiva.
6. Clique em **Criar follow-up**.

O follow-up é persistido no CRM e enfileirado internamente. A criação da tarefa **não envia WhatsApp automaticamente**.

O horário é considerado no fuso operacional do Instituto (`America/Sao_Paulo`).

## Fila operacional

A fila mostra apenas itens que precisam de ação humana. Os principais tipos são:

### Follow-up

Quando chegar o momento do contato, o item fica disponível para a secretária registrar o resultado.

Resultados possíveis:

- **Contato realizado** — o retorno foi feito e a tarefa é concluída.
- **Sem resposta** — registra a tentativa e encerra a tarefa atual.
- **Cliente pediu retorno** — exige nova data e novo horário; o sistema conclui a tarefa atual e cria uma nova tarefa interna.
- **Não foi possível contatar** — registra o resultado sem afirmar que houve envio.

Nunca use “Contato realizado” se não houve contato real.

### Recuperação de experiência

Aparece quando uma resposta suportada da pesquisa indica **Poderia melhorar** e o fluxo de experiência estiver habilitado em produção.

Resultados possíveis:

- **Problema tratado / experiência recuperada**;
- **Encerrar atendimento sem solução**;
- **Reagendar contato**.

Registre a observação de forma factual: o que foi feito, qual encaminhamento foi oferecido e qual foi o desfecho. Não peça para o cliente remover, alterar ou evitar uma avaliação pública.

## Atendimentos

Acesse `/atendimentos` para registrar a fonte operacional de um atendimento realizado.

### Registrar atendimento

1. Selecione o cliente/lead.
2. Selecione o serviço.
3. Informe a data.
4. Adicione observação apenas quando necessária.
5. Salve.

O atendimento entra como **Agendado** nessa página até ser concluído ou cancelado.

### Concluir atendimento

Clique em **Concluir** somente depois que o atendimento realmente ocorreu.

O sistema pergunta se o cliente autorizou receber contato de acompanhamento pelo WhatsApp para pesquisa de experiência. Marque a opção somente quando essa autorização tiver sido obtida conforme o procedimento interno do Instituto.

- Sem autorização: o atendimento é concluído e nenhum evento de pesquisa é gerado.
- Com autorização e telefone válido: o atendimento fica apto a gerar o evento `service_completed`.
- Enquanto `CUSTOMER_EXPERIENCE_ENABLED=false`, esse evento é consumido como `no-op`: nenhuma pesquisa é criada ou acumulada para envio posterior.

A página `/atendimentos` nunca chama a Meta diretamente.

### Cancelar atendimento

Use **Cancelar** quando o atendimento não ocorreu. O registro é preservado no histórico; não é apagado.

## Pesquisa de experiência

Quando a funcionalidade for homologada e habilitada, o modelo aprovado oferecerá três respostas:

- **Excelente**;
- **Boa**;
- **Poderia melhorar**.

Excelente e Boa podem preparar o convite neutro de avaliação. Poderia melhorar abre recuperação interna para a secretaria. A resposta do cliente deve ser respeitada; não transforme a pesquisa em pedido de nota alta.

## Avaliação Google

O convite público é neutro. A secretaria não deve:

- pedir “5 estrelas”;
- condicionar benefícios a uma avaliação positiva;
- desencorajar avaliações negativas;
- pedir ao cliente para apagar ou mudar uma avaliação crítica.

O objetivo é permitir que o cliente compartilhe a experiência de forma voluntária.

## Mensagens e estados importantes

- `pending`: aguardando momento/processamento.
- `awaiting_operator`: exige ação humana.
- `completed`: fluxo interno concluído.
- `sent`: provedor aceitou um envio externo.
- `retry`: falha conhecida e elegível a nova tentativa.
- `dead_letter`: falha terminal que precisa de diagnóstico.
- `delivery_unknown`: resultado externo ambíguo; **não reenviar por conta própria**.
- `cancelled`: item invalidado ou já resolvido por outro caminho.

## O que fazer em caso de erro

Se a tela informar conflito de edição, atualize os dados e repita a operação. Isso normalmente significa que outra sessão alterou o CRM enquanto você trabalhava.

Se um item apresentar erro técnico, não crie várias tarefas iguais. Registre a ocorrência e encaminhe para manutenção. A fila possui deduplicação; duplicar manualmente pode piorar o diagnóstico.

Se o WhatsApp oficial ficar indisponível, não altere configurações da Meta ou Netlify por iniciativa própria. Use o processo de incidente e preserve o atendimento por canais já aprovados pela gestão.

## Regras de segurança operacional

- Não colar tokens, chaves ou senhas no CRM.
- Não apagar históricos para “limpar” a fila.
- Não criar follow-up fictício para testar produção.
- Não usar clientes reais como teste de automação.
- Não afirmar que uma mensagem foi enviada apenas porque a tarefa foi criada.
- Não alterar número oficial, templates ou configurações da Meta sem procedimento técnico.
- Sempre registrar o resultado real do contato, não o resultado esperado.
