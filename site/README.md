# Portal e comunidade ZapDMR 1.3.0

Portal publicado em **[www.zapdmr.com.br](https://www.zapdmr.com.br)**, com Cloudflare Workers Free e banco D1. A homepage foi aberta por HTTPS no navegador em 19/10/2026. O domínio sem `www` redireciona para o endereço canônico.

O estado da API também foi confirmado por HTTPS direto fora do sandbox restrito: `/v1/status` respondeu HTTP 200 com HSTS `max-age=31536000`, sem ignorar a validação de certificado.

**Publicação ainda em conclusão:** os instaladores foram enviados para uma Release em rascunho no GitHub, mas ela ainda não está publicada e as URLs de download do Worker permanecem vazias. O provedor de entrega de códigos também não foi configurado; novos usuários ainda não conseguem confirmar o telefone ou entrar no ZapChat.

O material de referência em `C:\ZapDMR_New\Site` continha README e uma demonstração HTML. Esta versão contém o servidor real e os ficheiros públicos, com recursos locais e sem dependências de CDN.

## Hospedagem gratuita escolhida

O responsável escolheu a opção gratuita. A pasta [`cloudflare/`](cloudflare/README.md) contém a implantação em Workers + D1. O Worker está publicado, o banco remoto foi criado e inicializado, os três segredos de produção foram configurados e a zona DNS está ativa na Cloudflare. Não é necessário contratar o servidor Node para essa opção.

O responsável é **Rizandro Cesar da Silva**, com contacto público **rizandro@gmail.com**. O repositório público [zapdmr/zapdmr](https://github.com/zapdmr/zapdmr) foi criado. APK, EXE, fontes e SHA-256 estão anexados ao rascunho da pré-release `v1.3.0`; falta publicá-la e ligar seus endereços ao portal. Os arquivos da Release serão públicos também fora do formulário. A entrega de códigos é uma configuração separada, necessária para confirmar números e liberar novas contas da comunidade.

Consulte a [arquitetura de autenticação](AUTENTICACAO.md) e o [registro da verificação de 19/10/2026](VERIFICACAO-2026-10-19.md) para componentes, fluxo de credenciais e limites observados.

As instruções Node/VPS abaixo continuam como alternativa; não são o procedimento de publicação do Worker.

## Executar localmente

Requer Node.js 22.13+ com `node:sqlite` (recomendado Node LTS atual).

```powershell
cd "C:\Users\User\Documents\Codex\2026-10-16\eu-vou-te-passar-o-instalador\outputs\site"
node server.mjs
```

Abra `http://127.0.0.1:3000`. O modo local cria chaves privadas dentro de `data/`. Não publique essa pasta nem a inclua em ZIPs de código. A produção exige os segredos no ambiente.

## O que está implementado

- Portal responsivo, formulário com indicativo, DMR ID e WhatsApp obrigatório em formato internacional.
- Cadastro persistente SQLite; telefone e mensagens cifrados com AES-256-GCM.
- Downloads reais via links assinados com validade de 15 minutos. Sem ficheiro, o portal informa a indisponibilidade.
- Pedido e confirmação de código, sessões de 30 dias, diretório autenticado por pesquisa exata.
- Partilha do número opcional, revogável e desativada por padrão. Cadastros sem confirmação não entram no diretório.
- ZapChat próprio, com histórico, leitura, bloqueio de contacto e eliminação de conta/mensagens.
- Integração WhatsApp por `https://wa.me/numero`: abre a aplicação oficial ou Web; o operador envia por lá.
- Painel administrativo de contagens/cadastros em `/admin`, com autenticação Basic e senha de ambiente. Não há lista pública de telefones.

**WhatsApp e ZapChat são serviços distintos.** Isto não incorpora as conversas de contas pessoais do WhatsApp dentro do ZapDMR. Não foi usada automação não oficial do WhatsApp. A confirmação por código valida o número informado, não uma licença de radioamador nem a titularidade do indicativo.

## Configuração Node/VPS — alternativa

Use `.env.example` como referência; o processo não carrega esse ficheiro automaticamente. Configure as variáveis no painel da hospedagem ou num ficheiro de ambiente protegido do serviço:

1. `NODE_ENV=production`, `PUBLIC_ORIGIN=https://www.zapdmr.com.br`.
2. `DATA_ENCRYPTION_KEY` e `DOWNLOAD_SECRET`: **segredos diferentes**, cada um com 64 caracteres hexadecimais aleatórios. Guarde cópias protegidas. Perder a chave impede ler os dados existentes.
3. `ADMIN_PASSWORD`: pelo menos 16 caracteres; não partilhar com os utilizadores.
4. `OWNER_NAME` e `PRIVACY_EMAIL`: responsável real e canal de privacidade. O servidor recusa iniciar em produção sem estes dados.
5. `DATA_DIR` e `DOWNLOAD_DIR`: armazenamento persistente fora de `public/`.
6. Proxy HTTPS (Caddy, Nginx ou plataforma). A porta Node deve permanecer inacessível externamente. `TRUST_LOCAL_PROXY=1` apenas quando um proxy local confiável sobrescrever `X-Real-IP`.
7. Backup cifrado do banco e backup separado das chaves, com permissões restritas.

O domínio no Registro.br e o pagamento não configuram a hospedagem ou o DNS automaticamente. Os ficheiros `Caddyfile` e `zapdmr.service` são modelos para VPS Linux; adapte utilizador/caminhos ao plano contratado.

### IP dos visitantes no VPS com Caddy

Ao utilizar o `Caddyfile` fornecido no mesmo VPS, configure `HOST=127.0.0.1` e **`TRUST_LOCAL_PROXY=1`**. O Caddy sobrescreve `X-Real-IP` com o endereço da ligação recebida e encaminha para o Node em loopback. A porta 3000 deve permanecer inacessível pela internet. Assim, os limites de cadastro e pedidos de código são aplicados a cada endereço visitante; com `0`, todos os visitantes atrás desse proxy partilhariam os limites do endereço local.

O exemplo conserva `TRUST_LOCAL_PROXY=0` para os demais cenários. Só altere para `1` quando houver um proxy local confiável que sobrescreva o cabeçalho; não confie num cabeçalho fornecido diretamente pelo visitante. Se houver outro proxy ou CDN antes do Caddy, adapte e verifique a cadeia de confiança antes da publicação.

## Entrega dos códigos — pendência de infraestrutura

Sem `OTP_DELIVERY_URL`, os downloads e cadastros funcionam, mas a verificação, o diretório e o chat não são ativados. Isso evita publicar números apenas porque alguém os digitou.

Configure um adaptador privado HTTPS de entrega de SMS ou de template de autenticação aprovado do WhatsApp Business. O servidor fará:

```http
POST https://seu-adaptador/entregar-codigo
Authorization: Bearer <OTP_DELIVERY_TOKEN>
Content-Type: application/json

{"phone":"+55...","code":"123456","expiresInSeconds":600}
```

O adaptador deve entregar o código ao titular e devolver sucesso HTTP somente se aceitou a entrega. Não registe o corpo, código ou número em logs. O código nunca é devolvido ao aplicativo. Há limites de tentativas, expiração de 10 minutos e bloqueio após cinco códigos errados.

Este pacote não cria contas em provedores de SMS/Meta, não inclui credenciais desses serviços e não realizou envios reais. A hospedagem Cloudflare já está ativa; o provedor de entrega ainda precisa ser definido pelo responsável.

## Instaladores

Na hospedagem Cloudflare atual, os arquivos serão servidos por GitHub Releases. Depois de publicar o rascunho `v1.3.0`, preencha `DOWNLOAD_ANDROID_URL`, `DOWNLOAD_WINDOWS_URL` e `SOURCE_URL` com os endereços reais dos assets e publique a configuração do Worker. Consulte o procedimento em [`cloudflare/README.md`](cloudflare/README.md).

Para a alternativa Node/VPS, coloque os artefactos finais com os nomes:

```
private/downloads/ZapDMR-Android.apk
private/downloads/ZapDMR-Windows.exe
private/downloads/ZapDMR-source.zip
```

O código-fonte correspondente é disponibilizado livremente em `/source`, sem cadastro, quando o arquivo ou sua URL estiver configurado. No Node, também pode utilizar `DOWNLOAD_DIR`. Os instaladores 1.3.0 permanecem nos arquivos de distribuição em `outputs/release` e `outputs/out`; o ZIP do site exclui os instaladores e todos os dados privados.

## Ligar o aplicativo ao serviço

No ZapDMR: **Definições → Perfil → Comunidade · WhatsApp e ZapChat**.

1. Preencha o WhatsApp obrigatório no perfil e guarde os dados de rádio.
2. Informe o servidor da comunidade e aceite o envio dos dados para esse endereço.
3. Escolha separadamente se autoriza a partilha do WhatsApp.
4. Cadastre-se. A solicitação e confirmação do código dependem da ativação do provedor de entrega, ainda pendente na produção atual.
5. Pesquise o indicativo ou DMR ID exato. “Chamar no Zap” abre o WhatsApp apenas se o titular partilhou o número; a caixa de conversa usa ZapChat.

O telefone e o token são protegidos por DPAPI no Windows e pelo armazenamento cifrado Android. Não são colocados em `localStorage`, nem enviados ao master DMR. O rádio não depende do servidor da comunidade para transportar áudio.

## Sincronização de mensagens e confirmações de leitura

`GET /v1/messages?peer=UUID&after=0&receiptAfter=0&wait=1` mantém o campo `messages` e acrescenta `receipts` com objetos `{id, readAt}` e `nextReceiptCursor`. Os cursores `after` e `receiptAfter` são inclusivos. Depois de receber mensagens, avance `after` para o maior `at` recebido mais 1. Para os recibos, use diretamente `nextReceiptCursor` na próxima consulta; quando não há recibos, o servidor conserva o cursor enviado. O limite de cada lista é de 100 elementos. Os horários das novas mensagens e das novas leituras são monotônicos, e a ordenação usa também o ID.

Novos clientes devem enviar `receiptAfter` desde a primeira consulta, aplicar os recibos às mensagens existentes pelo `id` e continuar a consulta com o cursor devolvido. `wait=1` permite aguardar até 25 segundos quando não existem mensagens nem recibos novos. `POST /v1/messages/read` devolve `{ok: true, changed: N}`. No Worker, a consulta pendente volta a procurar novidades após a espera; uma mensagem ou leitura pode levar até 25 segundos para aparecer.

O aplicativo 1.3.0 atual continua compatível com `messages` e `after`, mas não consome `receipts`: uma confirmação de leitura só aparece quando a mensagem volta a ser obtida numa nova sincronização do histórico. A atualização de leitura ao vivo requer adaptar o cliente para consumir os recibos. Esta documentação descreve o contrato implementado; não confirma uma validação completa com hospedagem, entrega de códigos e dispositivos reais.

## Antes do lançamento

Os textos de privacidade e termos descrevem esta implementação e já identificam o responsável e o contacto confirmados. Publique os instaladores, configure suas URLs, ative e valide a entrega de códigos e revise os procedimentos de atendimento/eliminação antes de anunciar a comunidade como operacional. O armazenamento é cifrado no servidor, **não ponta a ponta**. A verificação física de áudio, acessórios, GPS e a validação da entrega do código dependem dos dispositivos e da infraestrutura.

Referências: [WhatsApp Click to Chat](https://faq.whatsapp.com/5913398998672934/?locale=pt_BR), [APRS-IS](https://www.aprs-is.net/Connecting.aspx), [política de mosaicos OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/).
