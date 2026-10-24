# ZapDMR 1.4.4 — candidato Android

Implementação local das quatro melhorias solicitadas. Este documento não significa publicação no site ou no GitHub. APK Android: versão 1.4.4, código 17, assinado com a chave existente para atualização sem desinstalar.

## Operação

- Botão de energia no canto superior direito, ao lado das configurações. Confirmação com Cancelar e Desconectar. Recusa durante TX, com nova conferência no serviço Android. Encerra RX, inscrição ODTP, socket, áudio, vocoder, foco de áudio e serviço; mantém o processo do aplicativo disponível para reconectar. Não envia TG 4000.
- Bloqueio PTT por pacotes DMR da sessão local, no destino e slot selecionados; ignora origem própria e atividade global Last Heard. Apresenta **RX OCUPADO — AGUARDE**. Teclas físicas, Bluetooth, SPP, VOX e tela convergem no mesmo controle nativo.
- Proteção padrão de 500 ms após o terminador, configurável entre 0 e 3000 ms em Definições / Premir para falar. Novos pacotes renovam a proteção. Se o terminador faltar, expira após 1200 ms sem pacotes mais a proteção escolhida. Troca de TG e desconexão reinicializam o controle.
- A conferência final mantém o mesmo monitor durante o envio UDP: cabeçalhos e voz HBP/ODTP são rejeitados durante RX. Terminadores continuam permitidos para encerrar TX com segurança; autenticação, keepalive e inscrições não são PTT. Se RX surgir durante TX, a próxima tentativa de voz é rejeitada e a captura encerra pelo tratamento existente.
- A interface aguarda o evento nativo de aceitação de PTT; não presume que um pedido iniciou TX.
- Uma tentativa barrada antes do envio do cabeçalho não envia terminador. O encerramento do PTT impede iniciar outra captura ou desconectar até concluir a limpeza, evitando misturar duas transmissões.
- Indicativos no Last Heard abrem menu com ZapChat, QRZ.com e copiar. Indicativos internacionais e portáteis são validados; nomes são inseridos como texto. QRZ usa HTTPS, destino fixo e indicativo codificado. Clipboard e navegador externo usam APIs nativas no Android.
- ZapChat consulta o diretório real e verifica indicativo e DMR ID disponíveis antes de abrir o histórico. Participantes sem cadastro ou com vínculo divergente recebem aviso; nenhuma mensagem é enviada automaticamente.

## Arquivos alterados

- `android/app/src/main/java/br/radio/zapdmr/ReceiveGuard.java` (novo): controle temporal e classificação de pacotes.
- `RadioSessionService.java`, `OpenTerminal.java`, `MobileAudioPlugin.java`, no mesmo diretório: RX/TX, término ODTP, desconexão, navegador e clipboard.
- `android/app/build.gradle`: versão Android.
- `web/participant-actions.js` (novo): menus e confirmação de energia.
- `web/index.html`, `web/styles.css`: ícone, diálogos e apresentação responsiva.
- `web/app.js`, `web/operation-controls.js`, `web/mobile-audio.js`: estados e opções nativas.
- `web/community.js`, `web/community-chat.js`: encaminhamento e validação de identidade do colega.
- `electron/main.cjs`: permite a rota QRZ no mecanismo externo já existente.
- `src/server/index.ts`: recusa desconexão solicitada pela interface durante PTT no servidor local.
- `package.json`, `package-lock.json`: versão do projeto.
- `docs/PADROES-DE-RADIO.md` e este documento: comportamento permanente e resultados.
- `scripts/validation/ReceiveGuardTest.java`, `OpenTerminalTest.java`, `participant-actions.test.cjs`: cenários de regressão.
- Recursos `android/app/src/main/assets/public/` sincronizados automaticamente pelo Capacitor a partir de `web/`.

## Verificações realizadas

- JVM: RX ocupada, todos os tipos de comando usando o mesmo bloqueio, liberação em 500 ms, nova chamada durante proteção, terminador antigo, expiração sem terminador, configuração, reset de TG/desconexão e concorrência com envio.
- JVM: classificação dos pacotes reais HBP/ODTP bloqueando cabeçalho/voz e permitindo terminador/inscrição. Handshake ODTP, eventos de início/fim de RX e cancelamento antes de fechar.
- Harness de interface executando o código real: menu, QRZ correto, copiar, vínculo válido, ausente e divergente no ZapChat, confirmação e recusa de desconexão durante TX.
- Contratos de código (`radio-service-contract.test.cjs`): entrada nativa compartilhada, bloqueio no envio UDP, ausência de terminador se o cabeçalho foi recusado e proteção durante limpeza. São conferências de integração por código, não testes de hardware.
- Regressão: 120 atualizações preservam linhas/scroll/seleção do seletor de TG. Catálogo e fluxo ODTP com master UDP local isolado continuam passando.
- Compilação TypeScript do servidor e sintaxe JavaScript.
- Prévia local de 360 px: botão de energia e diálogos nos temas claro/escuro. Dados de participante são fixtures; nenhum cadastro ou envio real foi efetuado.
- Build Android release e verificação de assinatura v2/v3 e alinhamento. Resultado final e SHA-256 estão em `release/ZapDMR-Android-1.4.4.sha256`.

## Limitações e validação em aparelho

Não foi realizado teste em celular físico ou acessório Bluetooth/SPP real. Os testes desses comandos cobrem o controle compartilhado e o código, não o firmware de cada acessório. Também não foi feita conversa real entre duas contas durante esta alteração. O backend e a verificação WhatsApp existentes continuam necessários para entrar no ZapChat.

A ausência de RX local não garante que a rede esteja livre e não evita todas as colisões. O timeout permite recuperar o PTT quando pacotes/término são perdidos.

O bloqueio RX desta entrega é Android; a opção aparece identificada e desabilitada no Windows. Menus e botão de energia são compartilhados, mas um novo instalador Windows não foi gerado nesta tarefa.

Antes de divulgação geral, conferir no Android: ouvir outra estação e tentar tela/tecla/acessório; aguardar fim mais 500 ms; trocar TG durante RX; abrir participante cadastrado e não cadastrado; desconectar recebendo; reconectar; recusar energia durante TX e depois encerrar normalmente.
