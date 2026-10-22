# Notificações opcionais do ZapChat

Estado: integração preparada; o responsável ainda não tem projeto Firebase. Não existe envio push de produção configurado. O chat e os avisos com o aplicativo aberto continuam independentes do Firebase.

## Configuração futura

1. Criar projeto Firebase e registrar o aplicativo Android **br.radio.zapdmr**. Baixar `google-services.json` para `android/app/google-services.json`. O arquivo está excluído do Git e do pacote de fontes.
2. Habilitar Firebase Cloud Messaging HTTP v1. Criar uma conta de serviço com a permissão necessária para enviar mensagens neste projeto. Guardar a chave privada fora do repositório; nunca dentro do APK.
3. No diretório `site/cloudflare`, cadastrar por `wrangler secret put` os segredos `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` e `FCM_PRIVATE_KEY` (PEM PKCS8). Não colocar esses valores em wrangler.jsonc ou nesta documentação.
4. Aplicar migrações 0004, 0005 e 0006 antes de publicar o Worker. Recompilar o APK com o arquivo do projeto. Instalar por atualização, preservando a assinatura atual.
5. No perfil do ZapChat, o operador escolhe **Ativar avisos com o app fechado** e autoriza a permissão Android. Não há solicitação automática de permissão antes dessa escolha.

## Funcionamento

- SDK Messaging 25.1.3, inicialização automática desativada por padrão. Nenhuma dependência de Analytics foi adicionada.
- Registro por dispositivo autenticado, associado à família de sessão renovável. Token de notificação cifrado no D1; não exposto no diretório público ou em logs.
- A confirmação de entrega do chat depende do aplicativo buscar a mensagem e confirmar o recebimento, nunca da aceitação pelo FCM.
- Envio FCM HTTP v1 com OAuth2 de curta duração. Payload genérico sem texto da conversa, telefone ou indicativo. Apenas IDs internos permitem abrir o destinatário correto após autenticação.
- Canal silencioso de baixa importância. Não solicita foco de áudio, não inicia serviço de rádio e não aciona PTT.
- Fila transacional por mensagem/dispositivo, tentativa imediata após a gravação, recuperação por cron a cada minuto, até cinco tentativas e expiração em 24 horas. Bloqueios, leitura/entrega e revogação impedem novos avisos pendentes.
- Desativar remove o registro do servidor e o token do SDK. Tokens inválidos retornados como UNREGISTERED são removidos.
- O Android pode restringir notificações após “Forçar parada”, ausência de serviços Google, permissões negadas ou restrições de bateria. Fechar a interface não equivale a forçar parada. Isso precisa ser verificado em aparelho real depois de configurar o projeto.

Referências oficiais consultadas:

- https://firebase.google.com/docs/cloud-messaging/android/get-started
- https://firebase.google.com/docs/cloud-messaging/send/v1-api
- https://github.com/firebase/firebase-android-sdk/blob/main/firebase-messaging/CHANGELOG.md

## Validação pendente

Sem projeto/credenciais não houve teste de entrega FCM externa. Validar com duas instalações: app aberto, em segundo plano, removido dos recentes e reaberto por notificação; logout, token renovado e notificações negadas. Não apresentar esses cenários como aprovados apenas pela compilação.
