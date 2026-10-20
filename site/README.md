# Portal e comunidade ZapDMR 1.3.1

O portal está publicado em **[www.zapdmr.com.br](https://www.zapdmr.com.br)**, usando Cloudflare Workers Free e D1. O responsável é **Rizandro Cesar da Silva**; contato e privacidade: **rizandro@gmail.com**. O domínio sem www redireciona para a origem canônica.

## Estado em 20/10/2026

O frontend e a API 1.3.1 com confirmação de WhatsApp foram publicados no Worker. A migração OTP foi aplicada ao D1 remoto. Os instaladores locais `release/ZapDMR-Android-1.3.1.apk` e `release/ZapDMR-Windows-1.3.1.exe` foram gerados. A configuração de URLs de download deve acompanhar a Release realmente publicada; enquanto ela apontar para v1.3.0, esse é o instalador distribuído pelo portal.

A ponte WhatsApp local está aberta em **http://127.0.0.1:4193**, com QR disponível para o responsável vincular o número oficial **+55 43 99674-1200**. O pareamento humano e a primeira entrega real ainda estão pendentes. Um QR gerado ou `verificationConfigured:true` não comprova envio nem posse de um número.

Consulte [a verificação de hoje](VERIFICACAO-2026-10-20.md). O [registro de 19/10/2026](VERIFICACAO-2026-10-19.md) permanece como histórico da versão anterior.

## Fluxo de cadastro e ativação

1. No site ou em **Definições → Perfil → Comunidade · WhatsApp e ZapChat** do app, preencha indicativo, DMR ID e WhatsApp internacional; aceite o uso dos dados. A partilha do telefone com outros operadores é uma escolha separada, desativada por padrão.
2. Ao continuar, a interface abre a confirmação de seis dígitos. O código expira após dez minutos, permite até cinco tentativas e pode ser reenviado após 60 segundos. É possível corrigir o número e iniciar outro cadastro.
3. A API usa o adaptador HTTPS configurado ou a ponte local conectada para entregar o código. Se a entrega estiver indisponível, pode oferecer confirmação reversa: o usuário envia pelo próprio WhatsApp a mensagem pronta para o número oficial.
4. A confirmação reversa só é aceita após o servidor receber, de uma ponte autenticada, o remetente real e a mensagem com desafio aleatório e código correspondentes. Abrir um link wa.me ou digitar um código exibido não confirma o telefone.
5. A validação consome o desafio, marca o número real como confirmado, cria uma sessão de 30 dias para ZapChat e devolve um link assinado de download com validade de 15 minutos quando o instalador estiver disponível.

O fluxo do portal agora exige confirmação antes de liberar o instalador. As Releases públicas do GitHub continuam acessíveis fora desse fluxo, e o código-fonte GPL permanece público em `/source`. A confirmação do número não comprova licença, indicativo ou atribuição do DMR ID.

## Entrega pelo WhatsApp

A configuração completa está em [WHATSAPP-OTP.md](WHATSAPP-OTP.md).

| Modo | Configuração | Comprovação |
| --- | --- | --- |
| Adaptador direto | `WHATSAPP_API_URL` e `WHATSAPP_API_TOKEN` | Código entregue pelo adaptador privado e digitado pelo titular |
| Ponte local | `WHATSAPP_LOCAL_BRIDGE=1`, número oficial, token privado e sessão QR ativa | Fila no Worker, envio pelo WhatsApp vinculado e validação do código |
| Reverso | `WHATSAPP_CONFIRM_NUMBER` e `WHATSAPP_WEBHOOK_TOKEN` | Mensagem recebida do próprio número por webhook autenticado |
| Homologação Node | `OTP_MODE=development`, ambiente e acesso locais | Demonstração isolada; nunca marca WhatsApp real como confirmado |

O adaptador direto recebe `POST {number,text}` com Bearer privado. O formato legado `OTP_DELIVERY_URL`/`OTP_DELIVERY_TOKEN` continua disponível com `{phone,code,expiresInSeconds}`. Provedores com outro contrato precisam de um adaptador.

A [ponte local](whatsapp-bridge/README.md) usa Baileys 6.7.24, um cliente independente e sem vínculo oficial com a Meta. O PC e a conexão precisam permanecer ativos. A ponte consulta a fila por HTTPS de saída a cada cinco segundos; não precisa de túnel nem porta pública. O painel fica apenas em loopback. Configuração e sessão usam DPAPI CurrentUser do Windows, sem credenciais em texto no disco. O número vinculado precisa corresponder ao oficial; grupos, histórico e mensagens próprias não são encaminhados como confirmação.

Não existe código mestre de produção nem aprovação automática. Sem envio disponível e sem mensagem reversa recebida por uma ponte válida, o número permanece pendente. O modo de homologação Node usa exclusivamente `zapdmr-development.sqlite`, exige origem/escuta/acesso locais e é recusado em produção; suas contas recebem `whatsapp_verified=false`.

## Hospedagem e arquivos

A implantação atual está em [cloudflare/](cloudflare/README.md), com Worker `zapdmr-community`, banco D1 remoto, domínio HTTPS e segredos privados. O servidor Node de `server.mjs` é uma alternativa de hospedagem.

O repositório [zapdmr/zapdmr](https://github.com/zapdmr/zapdmr) e a [Release v1.3.0](https://github.com/zapdmr/zapdmr/releases/tag/v1.3.0) já estavam publicados. Uma atualização 1.3.1 deve publicar APK, EXE, fontes correspondentes e hashes e depois atualizar as URLs do Worker. Não coloque instaladores grandes nos assets estáticos nem no histórico Git.

Na alternativa Node, coloque os arquivos finais em:

```text
private/downloads/ZapDMR-Android.apk
private/downloads/ZapDMR-Windows.exe
private/downloads/ZapDMR-source.zip
```

O arquivo `.env.example` documenta a configuração. O processo não o carrega automaticamente: configure o ambiente protegido do serviço. Node 22.13+ é necessário para `node:sqlite`.

```powershell
node server.mjs
```

A origem local padrão é `http://localhost:3000`; o servidor escuta em `127.0.0.1`. Chaves e banco ficam fora de `public/`. A produção requer origem HTTPS, responsável, e-mail, chave de dados e segredo de download distintos com 64 caracteres hexadecimais e senha administrativa forte. Mantenha backups cifrados do banco e proteção separada das chaves.

Com o Caddyfile no mesmo VPS, `TRUST_LOCAL_PROXY=1` só deve ser usado quando o proxy sobrescrever X-Real-IP e a porta Node permanecer inacessível externamente. O padrão 0 não confia em cabeçalhos fornecidos por visitantes.

## Credenciais, privacidade e conversa

O app protege telefone e token por DPAPI no Windows e armazenamento cifrado com AndroidKeyStore no Android. O token não fica no localStorage. A sessão da comunidade é separada da Hotspot Security Password e do handshake HBP; o áudio do rádio não transporta esses dados.

ZapChat é o chat próprio do ZapDMR. O botão **Chamar no Zap** abre o WhatsApp oficial quando o titular compartilhou o número. As conversas pessoais do WhatsApp não são incorporadas ao aplicativo. Dados de telefone e conteúdo de ZapChat são cifrados antes da persistência; o servidor possui a chave, portanto não há cifragem ponta a ponta. Consulte [AUTENTICACAO.md](AUTENTICACAO.md) para componentes, requisições e tratamento de tokens.

O diretório exige autenticação e pesquisa exata. Bloqueios impedem descoberta e conversa nas duas direções. Excluir a conta remove sessões, mensagens e bloqueios associados. Sair da comunidade apaga o token local; não implementa revogação individual das demais cópias de sessão.

## Mensagens e recibos

`GET /v1/messages?peer=UUID&after=0&receiptAfter=0&wait=1` devolve mensagens, recibos `{id,readAt}` e `nextReceiptCursor`. Os cursores são inclusivos e cada lista tem até 100 elementos. Avance after ao maior at recebido mais 1; para recibos, use o próximo cursor devolvido. `POST /v1/messages/read` marca leituras do par autenticado.

No Worker, uma consulta pendente pode levar até 25 segundos para devolver novidades. O cliente deve enviar receiptAfter e aplicar receipts para atualizar leituras sem recarregar o histórico; o módulo atual ainda usa o contrato básico de mensagens. Não há garantia de atualização instantânea.

## Verificação pendente

O registro de hoje distingue revisão de código, migração e compilação de validação real. Depois do pareamento, ainda é necessário observar o recebimento de um OTP por um titular real, a validação que libera o download e uma conversa entre duas instalações. O pareamento e essas entregas não foram demonstrados nesta revisão.

As cotas de Workers/D1 e as condições de uso do WhatsApp precisam ser acompanhadas; hospedagem gratuita e ponte local não garantem operação contínua ou escala ilimitada.
