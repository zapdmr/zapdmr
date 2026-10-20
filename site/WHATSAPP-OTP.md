# Confirmação de WhatsApp do ZapDMR

O cadastro do portal e a ativação do perfil usam a mesma API de confirmação. O número é normalizado para E.164, por exemplo `+5543999999999`. Cada código tem seis dígitos, expira após dez minutos, permite até cinco tentativas e está vinculado ao cadastro com indicativo, DMR ID e número. Um novo código invalida o anterior. O reenvio tem intervalo mínimo de 60 segundos, também por número.

A comparação do código e do desafio usa HMAC. No Worker, o material temporário necessário à entrega e à confirmação reversa também fica cifrado com AES-256-GCM em `codes.challenge_cipher` e no payload da fila; não é persistido em texto aberto. Telefones e mensagens do ZapChat também são cifrados. O código de confirmação não comprova a licença de radioamador nem a titularidade do indicativo.

## Implantação Cloudflare e ponte local

A configuração de produção do ZapDMR usa o Worker `zapdmr-community`, o banco D1 e a ponte local em [`whatsapp-bridge/`](whatsapp-bridge/README.md). O número receptor autorizado pelo responsável é **+55 43 99674-1200** (`+5543996741200`). A configuração pública contém:

```dotenv
WHATSAPP_CONFIRM_NUMBER=+5543996741200
WHATSAPP_LOCAL_BRIDGE=1
```

`WHATSAPP_WEBHOOK_TOKEN` é um segredo privado compartilhado apenas entre Worker e ponte. O helper `cloudflare/configure-whatsapp-bridge.mjs` prepara esse token, guarda a configuração local com DPAPI CurrentUser e envia o segredo ao Worker sem colocá-lo nos arquivos públicos. Chaves do banco e da cifragem existentes são preservadas. O helper não conecta o WhatsApp por conta própria.

**O responsável precisa vincular o aparelho manualmente.** Abra o painel local em `http://127.0.0.1:4193`, clique em **Gerar QR / conectar** e, no WhatsApp do número oficial, use **Aparelhos conectados → Conectar aparelho** para escanear o QR. A ponte verifica que a sessão corresponde ao número autorizado antes de operar. O QR é uma credencial temporária e deve ser mostrado somente ao responsável. Nenhum QR exibido ou botão clicado comprova entrega de código a um usuário.

A ponte usa Baileys como cliente de aparelho vinculado; ela não é uma integração oficial da Meta. O computador deve permanecer ligado, conectado e com a ponte em execução para enviar ou receber confirmações. A sessão e as chaves do aparelho ficam cifradas em `session.dpapi`; a configuração com token fica em `config.dpapi`, sob `outputs/work/whatsapp-bridge`, fora de assets e pacotes públicos. Consulte o README da ponte para inicialização e manutenção. A preparação destes arquivos não confirma que o responsável já escaneou o QR ou que uma mensagem real foi entregue.

### Fila de envio e fallback

1. Com a sessão oficial conectada e o heartbeat recente, a API escolhe `mode: "bridge"`, cria o desafio e coloca na fila D1 somente o payload cifrado de uma mensagem OTP. A resposta pública informa `queued: true` e `sent: false`; não revela o código.
2. A ponte consulta `/v1/whatsapp/bridge/outbox` por HTTPS de saída. O Worker reserva trabalhos com lease; a ponte envia o texto e confirma o resultado em `/v1/whatsapp/bridge/ack`, repetindo o `leaseId` recebido. Nenhuma porta pública de entrada é necessária no computador.
3. Se a ponte confirma o envio, o usuário digita no portal ou no aplicativo os seis dígitos recebidos no seu WhatsApp. A API confere o HMAC e consome o desafio antes de liberar a sessão e o link de download.
4. Se o envio falha, ou a ponte deixa de estar disponível e a tentativa expira, o Worker muda o desafio para `reverse`. `/v1/auth/status` inclui o desafio atualizado; a interface mostra o botão verde com a mensagem pronta para o número oficial. Sem uma ponte receptora conectada, essa alternativa continuará pendente até o serviço ser restabelecido.

O painel local somente controla a ponte em loopback. A autenticação dos endpoints de fila, heartbeat, ACK e recepção usa `Authorization: Bearer <WHATSAPP_WEBHOOK_TOKEN>`. Não publique essa porta, o token, os arquivos DPAPI ou o QR. O envio externo não tem garantia de exatamente uma entrega; os leases, ACKs e a deduplicação local reduzem mensagens repetidas.

## Envio direto por adaptador — alternativa

Configure no ambiente privado do servidor:

```dotenv
WHATSAPP_API_URL=https://seu-adaptador.example/whatsapp/send
WHATSAPP_API_TOKEN=segredo-do-adaptador
```

O ZapDMR envia `POST` com `Content-Type: application/json` e `Authorization: Bearer <WHATSAPP_API_TOKEN>`:

```json
{"number":"+5543999999999","text":"*ZapDMR:* Olá PU5RZS, seu código de confirmação de 6 dígitos é: *482910*. Forte 73!"}
```

O endpoint precisa aceitar esse contrato, entregar a mensagem pelo provedor e devolver HTTP 2xx somente quando aceitar o envio. APIs com outro formato, como templates de autenticação da WhatsApp Cloud API, precisam de um adaptador. Não basta colocar a URL nativa do provedor sem adaptar o contrato. Não registre o corpo com o código em logs.

O adaptador anterior continua disponível por `OTP_DELIVERY_URL` e `OTP_DELIVERY_TOKEN`, recebendo `{phone,code,expiresInSeconds:600}`. É usado somente quando as duas configurações `WHATSAPP_API_*` estão vazias. As credenciais nunca entram no HTML ou no aplicativo.

## Confirmação reversa com mensagem recebida

Em outra implantação, configure o número real que recebe mensagens do ZapDMR e um segredo aleatório com pelo menos 32 caracteres. Na configuração deste projeto, o número é `+5543996741200` e o segredo deve continuar fora do código:

```dotenv
WHATSAPP_CONFIRM_NUMBER=+5543996741200
WHATSAPP_WEBHOOK_TOKEN=segredo-aleatorio-com-pelo-menos-32-caracteres
```

Se o envio direto estiver ausente ou falhar, o portal mostra **Confirmar pelo meu WhatsApp**. O link `wa.me` contém uma mensagem pronta:

```text
ZapDMR CONFIRMAR <desafio-aleatorio-de-43-caracteres> <codigo-de-6-digitos>
```

O usuário precisa enviá-la pelo mesmo número informado. Um receptor de mensagens de confiança deve extrair **do evento autenticado do provedor** o remetente e o texto, e encaminhar:

```http
POST /v1/whatsapp/webhook
Authorization: Bearer <WHATSAPP_WEBHOOK_TOKEN>
Content-Type: application/json

{"number":"+5543999999999","text":"ZapDMR CONFIRMAR <desafio> <codigo>"}
```

O remetente não pode ser obtido de um campo editável pelo usuário. O adaptador deve validar a assinatura ou autenticação do evento original antes de usar seu segredo para chamar o ZapDMR. O endpoint não é um formulário público. Ele compara remetente, desafio, código, prazo e tentativas. Só então registra a confirmação recebida. O portal consulta o estado e conclui a validação. Abrir o WhatsApp, exibir um código ou clicar em um botão não confirma um número.

Esse modo ainda exige um receptor conectado ao WhatsApp. O link `wa.me` sozinho não recebe mensagens no servidor. Quando número e segredo reversos estão configurados, a API pode oferecer o desafio `reverse` mesmo com a ponte desconectada; ele continuará pendente até o receptor receber e encaminhar a mensagem. Se nenhuma forma de confirmação estiver configurada, o estado será `unavailable`. Em ambos os casos, a interface não inventa uma validação.

## Contrato do portal e do aplicativo

1. `POST /v1/registrations` recebe `{callsign,dmrId,whatsapp,platform,noticeAccepted:true,sharePhone,requestVerification:true}`. Retorna `registrationId`, `verificationRequired:true`, `downloadUrl:null` e `challenge`.
2. O desafio informa `mode` (`direct`, `bridge`, `reverse`, `development` ou `unavailable`), `sent`, `expiresInSeconds`, `retryAfterSeconds`, `message` e, quando aplicável, `challengeToken`. `bridge` pode informar `queued`; nunca expõe o código. Em confirmação reversa também inclui `whatsappUrl` e `displayCode`.
3. `POST /v1/auth/request-code` com `{registrationId}` solicita reenvio após 60 segundos e retorna um novo desafio.
4. `POST /v1/auth/status` recebe `{registrationId,challengeToken}` e retorna `status` (`pending`, `confirmed` ou `expired`), contadores atualizados e o `challenge` atual. Assim a interface acompanha o fallback de `bridge` para `reverse`. No modo reverso, `confirmed` significa que o webhook confiável recebeu a mensagem correta. Portal e aplicativo consultam a cada quatro segundos enquanto a etapa de confirmação está visível; `retryAfterSeconds` controla somente o reenvio, e respostas de erro podem ampliar a espera.
5. `POST /v1/auth/verify` recebe `{registrationId,code,challengeToken}`. O modo reverso exige confirmação prévia no webhook. Na conclusão, o código é consumido; a API retorna uma sessão de 30 dias, usuário e URL de download assinada por 15 minutos quando o instalador estiver disponível.

Cadastros reais confirmados recebem `whatsapp_verified=1` e `verified_at`. O download do portal consulta o registro confirmado antes de servir o arquivo. A sessão libera o ZapChat. Não existe código mestre. Logout local não revoga automaticamente outras sessões; excluir a conta elimina sessões, códigos e conversas vinculadas. As URLs de releases públicas do GitHub continuam publicamente acessíveis fora deste portal.

## Homologação local

Para demonstrar o fluxo sem enviar mensagens:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PUBLIC_ORIGIN=http://localhost:3000
OTP_MODE=development
```

Esse modo aparece claramente como homologação, mostra o código e usa exclusivamente `zapdmr-development.sqlite`, separado de `zapdmr.sqlite`. A escuta, a origem e o cliente precisam ser locais. O servidor recusa iniciar com esse modo em produção ou com origem/escuta pública. As contas ficam com `whatsapp_verified=0` e `verification_method=development`: não representam números confirmados reais.

## Migração do servidor Node

Na inicialização, `server.mjs` adiciona colunas ausentes sem apagar registros: `registrations.whatsapp_verified`, `registrations.verified_at`, `users.whatsapp_verified`, `users.verification_method`, `codes.requested_at`, `codes.mode`, `codes.challenge_hash` e `codes.reverse_confirmed_at`. Usuários existentes que já passaram pelo fluxo anterior mantêm confirmação; cadastros sem confirmação não ganham acesso ao download. Um índice único protege o desafio reverso.

## Migração D1 do Worker

Para o banco existente da versão 1.3.0, a migração aditiva `cloudflare/migrations/0001_whatsapp_otp.sql` acrescenta os campos de verificação e desafio, `challenge_cipher`, a fila `whatsapp_outbox` e o estado `whatsapp_bridge_state`. O esquema completo atualizado está em `cloudflare/schema.sql` para bancos novos. Não aplique a migração de colunas novamente a um banco que já usa o esquema novo; `ALTER TABLE ADD COLUMN` não é idempotente. Faça backup e confira o esquema antes de qualquer mudança remota.

Defina segredos com o gerenciador privado da hospedagem, nunca em arquivos públicos, commits, argumentos de linha de comando ou screenshots. Escolher o modo reverso não dispensa fornecer o número receptor e conectar o webhook. A integração de produção só deve ser anunciada como operacional depois que o responsável vincular o aparelho e a entrega ou recepção real for confirmada; o modo de homologação não substitui essa etapa.
