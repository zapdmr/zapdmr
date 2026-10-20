# Verificação da atualização OTP — 20/10/2026

Este registro distingue implementação, publicação e compilação de confirmação real por WhatsApp. O [registro de 19/10/2026](VERIFICACAO-2026-10-19.md) foi preservado como histórico.

## Implementação e revisão de código

- Portal e perfil do aplicativo receberam confirmação de seis dígitos, validade de dez minutos, reenvio após 60 segundos, até cinco tentativas e correção do número.
- O cadastro não devolve link de instalador antes da confirmação. O Worker exige `whatsapp_verified=1` e `verified_at` também no endpoint de download.
- Validação cria uma sessão Bearer opaca de 30 dias e consome o desafio; o link de instalador tem assinatura HMAC e validade de 15 minutos.
- Adaptador HTTPS modular com `WHATSAPP_API_URL` e `WHATSAPP_API_TOKEN`, contrato `{number,text}`. O adaptador legado permanece disponível.
- Confirmação reversa exige mensagem recebida do número cadastrado, nonce aleatório, código correto, prazo e webhook autenticado. Código visível ou abertura de link não aprovam o número.
- O Worker armazena HMAC para comparação, desafio temporário cifrado e payload da fila cifrado. Não guarda códigos em texto claro no banco.
- Fila local com leases, `leaseId`, ACK condicionado à tentativa e fallback para confirmação reversa. O estado distingue solicitação na fila de envio confirmado.
- Backend Node alternativo recebeu migração incremental, entrega direta/reversa e homologação local. O modo visível usa `zapdmr-development.sqlite` separado, mantém `whatsapp_verified=false` e é recusado em produção ou acesso público.
- Não existe código mestre de produção. A autenticação HBP do rádio permanece separada do telefone, OTP e sessão do ZapChat.

Esses itens são constatações da revisão de código; não equivalem a testes de envio real.

## Publicação e banco

- O frontend e a API 1.3.1 foram publicados no Worker `zapdmr-community`, para `https://www.zapdmr.com.br`.
- A primeira publicação OTP deste dia teve versão Cloudflare `590f8ea9-a786-464c-bfa5-539204dfa9c3`. Republicações posteriores de assets, polling ou URLs podem ter outro UUID; esse identificador registra a primeira publicação e não pretende representar o último deploy.
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

## Builds locais

| Arquivo | Tamanho observado |
| --- | --- |
| `release/ZapDMR-Android-1.3.1.apk` | 7.340.662 bytes |
| `release/ZapDMR-Windows-1.3.1.exe` | 160.699.904 bytes |

Os arquivos 1.3.1 foram gerados localmente. APK, EXE, fontes correspondentes e hashes precisam estar na Release efetiva e ter suas URLs conferidas antes de anunciar a distribuição. A configuração de download pode permanecer em v1.3.0 durante essa atualização; existir um build local não demonstra sua publicação.

O firmware autorizado é incluído nos pacotes locais e pode ser instalado no primeiro arranque ou restaurado por Ativar / Reparar vocoder sem internet. Esta revisão não comprovou RX/TX físico em aparelho.

## O que não foi comprovado nesta revisão

- Não houve novo teste unitário ou smoke funcional do fluxo OTP/fila/ponte. Os 38 checks isolados de 19/10 pertencem à implementação anterior.
- Ainda não há entrega real de código de seis dígitos registrada após o pareamento.
- Ainda não há validação positiva de número em produção, seguida de download e ativação do perfil no dispositivo.
- Ainda não há conversa entre duas instalações reais demonstrada após a nova validação.
- As Releases públicas são acessíveis fora do formulário, e fontes GPL permanecem públicas. O formulário não garante cadastro de todos que recebam o instalador.
- Polling de mensagens pode levar até 25 segundos e depende das cotas de Workers/D1. A ponte em polling também consome requisições e escritas.

Próxima etapa concreta: observar a entrega/recepção de confirmação de um titular e a validação positiva no portal ou aplicativo, sem usar homologação como prova de posse do número. A ponte deve permanecer conectada durante esse fluxo.
