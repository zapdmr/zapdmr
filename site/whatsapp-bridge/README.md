# Ponte local de WhatsApp do ZapDMR

Esta ponte Windows conecta o WhatsApp do número oficial do ZapDMR ao Worker do portal. Usa o pacote upstream `@whiskeysockets/baileys` fixado em `6.7.24` (tag estável `legacy`; a tag `latest` consultada era `7.0.0-rc14`). Baileys é um cliente independente, sem vínculo oficial com a Meta. Não há mensalidade desta ponte; o computador precisa permanecer ligado e conectado. A disponibilidade depende da sessão do WhatsApp e pode haver restrições da plataforma.

## Configuração privada

O arquivo padrão é `outputs/work/whatsapp-bridge/config.dpapi`, fora do diretório público do site. É um **blob binário DPAPI CurrentUser** contendo este JSON antes da cifragem:

```json
{"version":1,"origin":"https://www.zapdmr.com.br","number":"+5543996741200","token":"SEGREDO_WHATSAPP_WEBHOOK_TOKEN_COM_32_OU_MAIS_CARACTERES"}
```

O mesmo token deve estar configurado como segredo `WHATSAPP_WEBHOOK_TOKEN` no Worker. A proteção deve ser criada no mesmo usuário do Windows que executará a ponte. Não coloque o token em argumentos, logs ou arquivos de texto. O helper `dpapi.ps1` recebe dados privados por stdin e retorna resultado por stdout capturado pelo processo; ele não deve ser chamado em um terminal que exiba os dados privados.

## Instalar e abrir

Use Node.js 22.13 ou superior. Na pasta desta ponte, instale com `npm ci --ignore-scripts` quando existir o lockfile. O pacote Baileys dessa versão possui uma dependência Git pública. Se o ambiente tentar usar SSH, configure apenas para o comando a reescrita de `ssh://git@github.com/` para `https://github.com/`; mantenha a validação TLS. Não é necessário acesso a repositórios privados nem chave SSH.

Execute `start-bridge.ps1` com `-ConfigPath` apontando ao arquivo privado, ou use `node bridge.mjs --config CAMINHO_DO_ARQUIVO_DPAPI`. Somente o caminho é argumento; nenhuma credencial é enviada na linha de comando.

Abra **http://127.0.0.1:4193**. Sem sessão vinculada, o processo aguarda uma ação no painel. Clique em **Gerar QR / conectar** e, no WhatsApp do número oficial, abra **Aparelhos conectados → Conectar aparelho** para escanear o QR. A câmera comum do telefone não substitui a função Aparelhos conectados. O QR é uma credencial temporária: mostre-o somente ao responsável. Nenhum código real é enviado antes de vincular a sessão e confirmar que o número corresponde à configuração. Uma sessão protegida previamente vinculada ao número correto pode ser retomada ao reiniciar a ponte. O identificador móvel brasileiro pode ter o nono dígito omitido pelo WhatsApp; o comparador aceita somente esse alias específico do mesmo DDD e número, sem aceitar outros números.

Se vincular outro número, a ponte se interrompe e preserva a sessão cifrada. Ela não remove credenciais nem altera a conta automaticamente. Para substituir uma sessão encerrada ou incorreta, pause a ponte, desvincule o aparelho no WhatsApp e faça a recuperação controlada do arquivo privado da sessão. Não apague arquivos de sessão com a ponte aberta.

## Operação

- Após conexão correta, consulta `/v1/whatsapp/bridge/outbox` a cada cinco segundos, com o token em `Authorization: Bearer` e `{number,connected:true}`. A fila entrega até cinco trabalhos; a ponte aceita apenas texto no formato OTP do ZapDMR e números E.164.
- Resolve o destino antes de enviar: para o próprio número oficial, usa o JID PN canônico da sessão conectada; para outro número, consulta `onWhatsApp` e aceita somente a identidade correspondente ao número informado ou ao alias móvel brasileiro específico com/sem nono dígito. Não interpreta dígitos de um LID como telefone.
- Envia `{id,status:"sent",leaseId}` após a submissão pela sessão. Esse ACK significa **encaminhado**, sem afirmar entrega no telefone. Recibos `DELIVERY_ACK` ou superiores geram `{id,status:"delivered",leaseId}`; uma falha gera `{id,status:"failed",leaseId}`. A ponte mantém o mesmo lease e envia a submissão antes do recibo, inclusive quando o evento de entrega chega antes de `sendMessage` terminar.
- O Worker mantém `lease_id` depois de `sent` para aceitar o recibo posterior da mesma tentativa. ACKs de outro lease são ignorados; `sent` não rebaixa `delivered`. Mantém-se uma lista cifrada limitada aos últimos 200 IDs enviados para reduzir duplicação. Uma interrupção no momento exato do envio ainda pode causar mensagem repetida; não há garantia de exatamente uma entrega no protocolo externo.
- Fornece `getMessage` ao protocolo com um cache em memória de no máximo 100 mensagens OTP por dez minutos. O cache permite retransmissão do conteúdo necessário pelo WhatsApp e é removido por expiração, entrega ou falha; os corpos não são registrados em logs nem persistidos em texto aberto.
- Informa conexão/desconexão em `/v1/whatsapp/bridge/heartbeat`. O endpoint outbox também mantém o estado vivo. O Worker precisa fornecer essas três rotas autenticadas e o mecanismo da fila.
- Recebe apenas mensagens novas diretas de remetentes externos cujo texto corresponda exatamente a `ZapDMR CONFIRMAR <43 caracteres do desafio> <6 dígitos>`. Extrai o número da identidade PN do WhatsApp, nunca dos dígitos de um LID, e envia `{number,text}` para `/v1/whatsapp/webhook`. O Worker confere desafio, número, validade e código.
- Ignora mensagens próprias na confirmação reversa, além de grupos, broadcasts, anexos e sincronização de histórico. Não arquiva conversas nem contatos; mantém apenas o cache temporário de OTP e os metadados de envio descritos acima. Baileys ainda precisa processar material de protocolo em memória para manter a sessão autenticada.
- **Pausar ponte** fecha a conexão sem excluir a sessão. Para retomar no mesmo painel, clique em conectar. Ao reiniciar o processo, uma sessão já vinculada ao número correto pode ser retomada sem novo QR.

## Proteção e limites

O painel escuta somente em `127.0.0.1:4193`, valida `Host`, usa CSP, não permite CORS, exige origem local e token de controle para ações. Nunca publique essa porta ou crie um túnel para ela. O tráfego para o Worker é exclusivamente HTTPS de saída, sem endpoint público no computador.

As credenciais Baileys, chaves Signal e IDs de entrega ficam no arquivo `session.dpapi`, cifrado por DPAPI CurrentUser. A gravação é serializada e substitui atomicamente um arquivo cifrado temporário. Não existe credencial em texto no disco. A ponte não usa `useMultiFileAuthState`, que grava arquivos de autenticação em JSON; implementa o estado de chaves com a serialização `BufferJSON` e conversão de chaves de sincronização exigidas pela biblioteca. O token de acesso fica somente em memória após abrir a configuração protegida. O logger Baileys é silencioso, e a saída interna de libsignal também é silenciada para impedir dumps de material de sessão. Não são exibidos tokens, QR bruto, números de destinatários, códigos ou corpos de mensagens em logs.

É necessário manter o Worker configurado e o aparelho vinculado. Um QR na tela não demonstra envio real. ACK `sent`, recibo `delivered`, relato humano de recebimento e validação do OTP são evidências diferentes: nenhum estado de entrega aprova o cadastro automaticamente. O próprio número oficial não tem fallback de confirmação reversa, pois mensagens `fromMe` são ignoradas; ele precisa receber e digitar um código real no aparelho principal. Não use códigos expostos ou homologação como prova de posse de um número real.

## Registro da revisão r2 — 20/10/2026

A API foi publicada no deploy `29f0793e-185e-44ba-9e83-c52491cc725a`. A ponte reiniciada retomou `connected: true`, e um reenvio real no mesmo cadastro registrou `lastDispatch.route: "self"` e `stage: "submitted"`. O titular confirmou o recebimento e digitou pessoalmente o código no site. O portal exibiu **WhatsApp confirmado**, o número confirmado na sessão e **Baixar Android (.apk)**, com download solicitado. A consulta restrita do D1 confirmou registro e usuário verificados, método `bridge` e uma sessão ativa, sem leitura de OTP ou token.

O fluxo real de recebimento humano, validação do código e liberação do download foi confirmado. O estado técnico permanece `submitted`, sem recibo automático de entrega registrado para esse envio a si mesmo. Não foram comprovados o término do download, instalação do APK, ativação da comunidade no app, conversa entre duas contas ou RX/TX físico de rádio.

O pacote do site `1.3.1-r2` foi anexado à Release, preservando os assets originais. Esta atualização corrige a entrega e o diagnóstico da ponte; não altera os aplicativos já publicados nem transforma o pareamento em validação de usuário.

## Referências upstream consultadas

- [Baileys no npm: instalação, QR e versões](https://www.npmjs.com/package/@whiskeysockets/baileys?activeTab=versions)
- [Implementação upstream do estado de autenticação](https://github.com/WhiskeySockets/Baileys/blob/master/src/Utils/use-multi-file-auth-state.ts)
- [Configuração upstream do socket](https://github.com/WhiskeySockets/Baileys/blob/master/src/Defaults/index.ts)

Os arquivos privados, `node_modules`, `.env`, logs e arquivos DPAPI não podem entrar no pacote público, no GitHub nem no diretório de assets do Worker. O lockfile contém apenas metadados de dependências públicas e deve acompanhar o código para instalações reproduzíveis.
