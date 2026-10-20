# Verificação da atualização OTP — 20/10/2026

Este registro distingue implementação, publicação e compilação de confirmação real por WhatsApp. O [registro de 19/10/2026](VERIFICACAO-2026-10-19.md) foi preservado como histórico.

## Implementação e revisão de código

- Portal e perfil do aplicativo receberam confirmação de seis dígitos, validade de dez minutos, reenvio após 60 segundos, até cinco tentativas e correção do número.
- O cadastro não devolve link de instalador antes da confirmação. O Worker exige `whatsapp_verified=1` e `verified_at` também no endpoint de download.
- Validação cria uma sessão Bearer opaca de 30 dias e consome o desafio; o link de instalador tem assinatura HMAC e validade de 15 minutos.
- Adaptador HTTPS modular com `WHATSAPP_API_URL` e `WHATSAPP_API_TOKEN`, contrato `{number,text}`. O adaptador legado permanece disponível.
- Confirmação reversa exige mensagem recebida do número cadastrado, nonce aleatório, código correto, prazo e webhook autenticado. Código visível ou abertura de link não aprovam o número.
- O Worker armazena HMAC para comparação, desafio temporário cifrado e payload da fila cifrado. Não guarda códigos em texto claro no banco.
- Fila local com leases, `leaseId`, ACK condicionado à tentativa e fallback para confirmação reversa para números elegíveis. A revisão r2 distingue fila, submissão `sent` e recibo `delivered`; nenhum desses estados aprova o OTP automaticamente. O próprio número oficial não recebe fallback reverso ou código exposto.
- Backend Node alternativo recebeu migração incremental, entrega direta/reversa e homologação local. O modo visível usa `zapdmr-development.sqlite` separado, mantém `whatsapp_verified=false` e é recusado em produção ou acesso público.
- Não existe código mestre de produção. A autenticação HBP do rádio permanece separada do telefone, OTP e sessão do ZapChat.

Esses itens são constatações da revisão de código; não equivalem a testes de envio real.

## Publicação e banco

- O frontend e a API 1.3.1 foram publicados no Worker `zapdmr-community`, para `https://www.zapdmr.com.br`.
- A primeira publicação OTP deste dia teve versão Cloudflare `590f8ea9-a786-464c-bfa5-539204dfa9c3`. Republicações posteriores de assets, polling ou URLs podem ter outro UUID; esse identificador registra a primeira publicação e não pretende representar o último deploy.
- O deploy da distribuição 1.3.1 foi `5a792aa8-4193-41ec-8d8a-85ed89392c98`, com URLs e hashes atualizados. A correção r2 da API foi publicada posteriormente em `29f0793e-185e-44ba-9e83-c52491cc725a`. `/v1/status` confirmou API 1.3.1 e ponte conectada.
- `/healthz` respondeu HTTP 200 com `ok: true` e versão 1.3.1. Homepage, privacidade, termos e código-fonte tiveram disponibilidade HTTP 200 confirmada. A rota `/health` retorna 404 e não foi contabilizada como verificação de saúde bem-sucedida.
- A migração remota D1 da atualização OTP concluiu 14 comandos. O banco é o existente `zapdmr-community`, binding `DB`, ID `6f272e21-de29-40a1-8bfd-801e00d2a95a`.
- A origem pública, responsável e contato continuam os confirmados: Rizandro Cesar da Silva e rizandro@gmail.com.
- O token privado da ponte foi preparado para o Worker e para configuração DPAPI CurrentUser. Seus valores não constam neste registro.

## Ponte local, pareamento e retomada confirmados

- Baileys upstream 6.7.24, pino 9.14.0 e qrcode 1.5.4 foram fixados; a instalação concluiu com 118 pacotes e lockfile. Scripts de instalação não foram executados.
- O processo da ponte foi aberto no Windows, com painel apenas em `http://127.0.0.1:4193`. O QR foi disponibilizado ao responsável.
- O número oficial configurado é `+5543996741200`. A ponte exige a mesma identidade conectada, admitindo somente o alias específico do nono dígito móvel brasileiro.
- Configuração e sessão usam DPAPI CurrentUser; chaves Signal e IDs enviados são persistidos cifrados. Logger Baileys e saída interna de libsignal são silenciados para evitar exposição de credenciais.
- A ponte envia apenas OTPs válidos do formato ZapDMR e encaminha somente novas mensagens diretas de confirmação, a partir do remetente PN real. Ignora grupos, broadcasts, mensagens próprias e histórico.
- O responsável concluiu a etapa de pareamento pelo QR; a ponte reconheceu a identidade oficial e apresentou `connected: true` antes da reinicialização.
- Após a primeira reinicialização controlada, o estado voltou a `idle`. Uma correção posterior e nova reinicialização concluíram a retomada da sessão: o painel local informou `connected: true`.
- A consulta de `https://www.zapdmr.com.br/v1/status` em produção confirmou `verificationMode: "bridge"`, `bridgeConnected: true` e `developmentMode: false`. O pareamento e a conexão operacional da ponte estão confirmados no momento observado; isso ainda não comprova entrega real de OTP ou disponibilidade contínua.
- Quando um novo pareamento for necessário, ele depende da ação humana em **WhatsApp → Aparelhos conectados → Conectar aparelho**; a câmera comum do telefone não substitui essa vinculação.

O QR disponível, as credenciais configuradas e o processo aberto não comprovam entrega de OTP. O PC e a conexão precisam permanecer ativos para a ponte operar.

## Correção r2 e confirmação real pelo titular

- A ponte passou a resolver o JID canônico: identidade PN da sessão para o próprio número oficial e consulta `onWhatsApp` para outros números, limitada aos aliases móveis brasileiros previstos.
- `getMessage` fornece ao protocolo um cache em memória limitado a 100 mensagens OTP por dez minutos. Metadados cifrados acompanham submissão e recibos sem registrar código ou corpo em logs.
- A API distingue `sent` como encaminhado e `delivered` como recibo automático. O ACK preserva o lease para o recibo posterior, sem permitir que uma tentativa antiga sobrescreva a atual ou que `sent` rebaixe `delivered`.
- A ponte foi reiniciada e retomou conectada. Um pedido real foi reenviado no mesmo cadastro; o diagnóstico local registrou `lastDispatch.route: "self"` e `stage: "submitted"`.
- Após a correção do JID, o titular respondeu **“Apareceu; vou validar no site”** e depois digitou pessoalmente os seis dígitos. A interface exibiu **WhatsApp confirmado**, **Número confirmado nesta sessão**, resultado **Download solicitado. Se não começar, use o botão abaixo** e link visível **Baixar Android (.apk)**.
- A consulta restrita do último cadastro de `PU5RZS` / DMR ID `7246584` confirmou `whatsapp_verified=1`, `verified_at=1792493306902`, usuário com `whatsapp_verified=1`, `verification_method=bridge` e uma sessão ativa. Nenhum OTP ou token foi lido durante a conferência.
- O fluxo real de recebimento humano, digitação do código pelo titular, perfil verificado e download liberado foi confirmado. Não houve aprovação automática por pareamento ou estado da fila.
- Ainda não foi registrado recibo automático `delivered` desse envio para si mesmo. O diagnóstico local permanece `submitted`; a evidência humana e a validação positiva não foram usadas para inventar um recibo técnico.

## Builds e distribuição publicada

| Asset publicado | Tamanho confirmado por HEAD HTTP 200 |
| --- | --- |
| `release/ZapDMR-Android-1.3.1.apk` | 7.340.662 bytes |
| `release/ZapDMR-Windows-1.3.1.exe` | 160.699.904 bytes |
| `release/ZapDMR-Android-1.3.1-source.zip` | 50.921.123 bytes |
| `release/ZapDMR-Site-Cloudflare-1.3.1.zip` | 219.395 bytes |
| Arquivo de hashes SHA-256 | 383 bytes |

A [Release v1.3.1](https://github.com/zapdmr/zapdmr/releases/tag/v1.3.1) foi publicada, com etiqueta no commit `005287f84f5c9503b1081b7cc05db347baa924db`. Há cinco assets enviados pelo projeto, além dos dois arquivos de fontes gerados automaticamente pelo GitHub. Os hashes informados pelo GitHub correspondem aos arquivos preparados localmente:

```text
178797625efb89c6ba7db77a160c239afe05c813ab6bc154c00b546fac957190  ZapDMR-Android-1.3.1.apk
e6fcf60f6e96b618c07a5ebdf2f2e34269b2cd4e363b2210985455b027f81a8a  ZapDMR-Windows-1.3.1.exe
8d1f63e770685bc7d5cb4938b42c8116ebebc631572f0b4d2c6dacc06335692e  ZapDMR-Android-1.3.1-source.zip
f46853ae009140533c0462f94e00381e8ac48fc384efd912d01f40e2c8404af1  ZapDMR-Site-Cloudflare-1.3.1.zip
```

As URLs e os hashes da versão 1.3.1 estão ativos no Worker. A disponibilidade dos assets e da API e a liberação do link pelo fluxo real de OTP estão confirmadas. Estes registros foram atualizados depois do empacotamento, sem regenerar ou substituir os ZIPs originais publicados.

A correção do site/ponte será adicionada à mesma Release como `ZapDMR-Site-Cloudflare-1.3.1-r2.zip`, com seu arquivo de hashes, usando `package-site-cloudflare.ps1 -Revision r2`. Os assets originais 1.3.1 e seus hashes acima serão preservados.

O firmware autorizado é incluído nos pacotes locais e pode ser instalado no primeiro arranque ou restaurado por Ativar / Reparar vocoder sem internet. Esta revisão não comprovou RX/TX físico em aparelho.

## O que não foi comprovado nesta revisão

- Não foi executada nova bateria automatizada do fluxo OTP/fila/ponte; a confirmação real manual está registrada acima. Os 38 checks isolados de 19/10 pertencem à implementação anterior.
- O recebimento humano e a validação positiva do número em produção foram confirmados após a correção r2; ainda não há recibo automático de entrega desse envio para si mesmo. Evidência humana e recibo técnico permanecem identificados separadamente.
- O portal liberou o download e informou a solicitação, mas não foi comprovada a conclusão do arquivo baixado, instalação do APK ou ativação do perfil da comunidade dentro do aplicativo.
- Ainda não há conversa entre duas instalações reais demonstrada após a nova validação.
- As Releases públicas são acessíveis fora do formulário, e fontes GPL permanecem públicas. O formulário não garante cadastro de todos que recebam o instalador.
- Polling de mensagens pode levar até 25 segundos e depende das cotas de Workers/D1. A ponte em polling também consome requisições e escritas.

O cadastro real no portal está confirmado e o download foi liberado. As próximas verificações em aparelho são a conclusão do arquivo, instalação/ativação no aplicativo e conversa entre duas contas; elas não foram tratadas como concluídas neste registro. A ponte deve permanecer conectada para novas confirmações.
