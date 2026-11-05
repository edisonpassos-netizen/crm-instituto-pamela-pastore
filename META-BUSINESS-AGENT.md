# Registro passivo de conversas do Meta Business Agent

O webhook aceita mensagens comuns e mensagens `value.standby.messages` de clientes enquanto outro respons�vel controla a conversa. As respostas em `value.standby.message_echoes` s�o salvas como `outbound`, usando o destinat�rio de `echo.message.to` como contato. Textos s�o preservados; outros tipos mant�m seu tipo e payload original, sem inventar conte�do renderizado de templates.

Esses eventos n�o acionam classifica��o de satisfa��o, pesquisas, respostas nem transfer�ncia de controle. A captura de leads de mensagens recebidas continua dependendo das flags e da lista expl�cita de n�meros autorizados j� existentes. Ecos de respostas nunca criam leads. Eventos de status em standby, transfer�ncia de controle e sincroniza��o hist�rica continuam sem processamento adicional nesta altera��o.

As assinaturas HMAC permanecem obrigat�rias. A grava��o de ecos usa a restri��o �nica existente em `provider_message_id` com `resolution=ignore-duplicates`; nenhuma tabela ou migration nova � necess�ria. Falhas de grava��o retornam 503 para permitir nova tentativa da Meta. As contagens `messagesReceived`, `messagesInserted` e `messagesDuplicate` incluem tanto mensagens recebidas quanto ecos registrados.

## Valida��o

`node --test tests/*.test.mjs`

Os testes locais usam fetch simulado; n�o enviam mensagens nem acessam bancos reais. Cobrem mensagens passivas, respostas do agente, repeti��o de eventos, rejei��o de assinatura inv�lida e falha de persist�ncia.

## Etapas ainda pendentes na Meta

1. Concluir a autentica��o do titular e confirmar os ativos do n�mero comercial correto.
2. Publicar o aplicativo, satisfazendo os requisitos exibidos pela Meta.
3. Manter a URL de callback e a assinatura `messages`; assinar tamb�m `standby`.
4. Conceder visibilidade em espera ao app nas configura��es de roteamento do neg�cio. S� a assinatura do campo n�o concede essa visibilidade.
5. Manter o Business Agent como respons�vel pelo atendimento; esta integra��o apenas observa.
6. Homologar um contato interno: recebimento, resposta do agente, hist�rico persistido e aus�ncia de duplica��o. Liberar captura de leads apenas para o n�mero verificado e conforme o escopo autorizado.

Fonte oficial: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/standby/

Esta altera��o n�o modifica tokens, n�mero comercial, configura��es da Meta, flags de envio, campanhas ou Agenda Pilates.

