# Registro passivo de conversas do Meta Business Agent

O webhook aceita mensagens comuns e mensagens `value.standby.messages` de clientes enquanto outro responsável controla a conversa. As respostas em `value.standby.message_echoes` são salvas como `outbound`, usando o destinatário de `echo.message.to` como contato. Textos são preservados; outros tipos mantêm seu tipo e payload original, sem inventar conteúdo renderizado de templates.

Esses eventos não acionam classificação de satisfação, pesquisas, respostas nem transferência de controle. A captura de leads de mensagens recebidas continua dependendo das flags e da lista explícita de números autorizados já existentes. Ecos de respostas nunca criam leads. Eventos de status em standby, transferência de controle e sincronização histórica continuam sem processamento adicional nesta alteração.

As assinaturas HMAC permanecem obrigatórias. A gravação de ecos usa a restrição única existente em `provider_message_id` com `resolution=ignore-duplicates`; nenhuma tabela ou migration nova é necessária. Falhas de gravação retornam 503 para permitir nova tentativa da Meta. As contagens `messagesReceived`, `messagesInserted` e `messagesDuplicate` incluem tanto mensagens recebidas quanto ecos registrados.

## Validação

`node --test tests/*.test.mjs`

Os testes locais usam fetch simulado; não enviam mensagens nem acessam bancos reais. Cobrem mensagens passivas, respostas do agente, repetição de eventos, rejeição de assinatura inválida e falha de persistência.

## Etapas ainda pendentes na Meta

1. Concluir a autenticação do titular e confirmar os ativos do número comercial correto.
2. Publicar o aplicativo, satisfazendo os requisitos exibidos pela Meta.
3. Manter a URL de callback e a assinatura `messages`; assinar também `standby`.
4. Conceder visibilidade em espera ao app nas configurações de roteamento do negócio. Só a assinatura do campo não concede essa visibilidade.
5. Manter o Business Agent como responsável pelo atendimento; esta integração apenas observa.
6. Homologar um contato interno: recebimento, resposta do agente, histórico persistido e ausência de duplicação. Liberar captura de leads apenas para o número verificado e conforme o escopo autorizado.

Fonte oficial: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/standby/

Esta alteração não modifica tokens, número comercial, configurações da Meta, flags de envio, campanhas ou Agenda Pilates.
