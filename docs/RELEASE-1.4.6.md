# ZapDMR 1.4.6 — ZapChat, sessão, atualização e áudio

Android versionCode **19**. Distribuição por APK assinado e instalador Windows, preservando dados existentes. Atualização opcional; nenhuma versão anterior é declarada incompatível nesta publicação.

## Correção encontrada

O cliente anterior consultava mensagens apenas quando a conversa com o destinatário já estava aberta. Não havia caixa de entrada global nem lista de conversas anteriores. Uma mensagem gravada no servidor podia parecer não recebida. Além disso, qualquer resposta HTTP 401, inclusive um OTP incorreto, apagava a sessão local. Não havia renovação da sessão nem confirmação específica de entrega ao dispositivo.

## Alterações

- Caixa de entrada autenticada, conversas recentes, contagem de não lidas e aviso dentro do aplicativo em outras telas. Histórico recuperado do servidor ao reabrir.
- Confirmações distintas: servidor aceitou, aplicativo destinatário recebeu e conversa foi lida. O Firebase aceitar um aviso nunca marca a mensagem como entregue.
- Fila de texto e anexos já carregados guardada no perfil protegido do dispositivo. Reenvios reutilizam o mesmo clientId, inclusive após reiniciar. Prévia não enviada é descartada ao trocar de conversa.
- Sessão de acesso de uma hora, renovação por dispositivo com inatividade máxima de 180 dias, rotação e tolerância curta para repetir uma resposta perdida. Logout revoga a família daquele dispositivo. Clientes antigos mantêm o protocolo anterior; uma sessão antiga válida pode migrar sem novo OTP.
- Falhas de rede e códigos OTP incorretos não apagam o login do chat. Confirmação inicial de WhatsApp permanece obrigatória. Credenciais do master DMR não são utilizadas para autenticar no chat.
- Android guarda comunidade separadamente das alterações do rádio, com commit cifrado e exclusão mútua. Windows guarda o perfil com DPAPI. Nenhum token vai para localStorage.
- Menu do indicativo: Conversar no Zap Chat, QRZ e copiar. A pesquisa verifica a correspondência de indicativo/Radio ID e abre o destinatário correto. Nome opcional no perfil.
- Verificação de atualização Android em cada abertura; oferta opcional uma vez por sessão. Download oficial com progresso, tamanho, SHA-256, packageId, versionCode e mesma assinatura da instalação atual. O instalador Android pede as autorizações/confirmacões normais. Não há instalação silenciosa nem desinstalação para atualizar.
- Antes de abrir o instalador, o rádio é encerrado pelo mesmo caminho confirmado da saída rápida. Recusa durante TX. Se o operador cancelar a instalação opcional, pode voltar e reconectar com o perfil protegido.
- Painel administrativo autenticado em `/admin/releases`: conferir/publicar APK oficial, novidades, obrigatoriedade com motivo e menor versão compatível, histórico e despublicação. O servidor rejeita uso Android incompatível quando uma política obrigatória estiver publicada.
- Integração Firebase opcional preparada. **Não configurada e sem entrega externa comprovada**. Leia [FIREBASE-ZAPCHAT.md](FIREBASE-ZAPCHAT.md).
- Áudio: controles TX e RX ampliados de 0–200% para **0–260%**, 30% mais margem. O ajuste é manual e separado para os dois caminhos. Valores salvos e padrão 100% preservados; não foi ativado AGC silenciosamente. Ganho excessivo pode saturar: ajustar usando o teste local do microfone e os medidores.
- Engrenagem superior removida; Definições continua na barra inferior. Saída rápida, recepção ODTP, bloqueio durante RX +500 ms, seletor estável e indicadores verdes/vermelhos preservados.

## Arquivos e banco

Frontend: `web/community.js`, `community-chat.js`, `community-session.js`, `community-outbox.js`, `app-updater.js`, `mobile-audio.js`, `participant-actions.js`, `index.html`, `styles.css`, `operation-controls.js`, `radio-console.js`, `app.js`.

Backend ativo: `site/cloudflare/api.mjs`, `auth-sessions.mjs`, `chat-inbox.mjs`, `chat-push.mjs`, `app-releases.mjs`, `worker.mjs`. O servidor local Windows `src/server/index.ts` preserva os novos campos do perfil protegido e envia ganho em u16 LE ao auxiliar de áudio atualizado.

Android: `ChatPushPlugin`, `ChatMessagingService`, `AppUpdatePlugin`, `MobileAudioPlugin`, `MainActivity`, `RadioSessionService`, manifesto e dependência Messaging 25.1.3. Auxiliar Windows: `native/audio-sidecar/src/main.cpp` suporta 260% e mantém comandos antigos de um byte.

Migrações aditivas: 0004 adiciona nome, entrega e famílias de sessão; 0005 adiciona dispositivos/fila push; 0006 adiciona histórico de versões. Não apagam cadastro, histórico ou favoritos. Aplicar antes de implantar o Worker novo. Segredos AES/HMAC existentes devem ser preservados.

Novas rotas: `/v1/auth/session`, `/v1/auth/refresh`, `/v1/auth/logout`, `/v1/inbox`, `/v1/conversations`, `/v1/messages/delivered`, `/v1/push/status`, `/v1/push/devices`, `/v1/app-releases/android`, `/admin/releases`. Todas as rotas de dados do chat exigem conta verificada; o manifesto de atualização é público.

## Evidências e limites

- API real com SQLite isolado: envio/recebimento entre contas fictícias, isolamento por destinatário, anexos até 15 MiB, histórico, leitura/entrega, bloqueio, exclusão em cascata e reenvio idempotente.
- Sessão: OTP v2 real em fixture, compatibilidade com cliente antigo, código de uso único, renovação, resposta perdida, logout e revogação. Harness do cliente verifica sessão preservada em falha de rede/OTP e fila após reabrir.
- Navegador: duas contas fictícias trocam mensagens nos dois sentidos; estados entregue/lida; reabertura e recarga recuperam histórico e sessão. Nenhuma mensagem enviada a radioamadores reais durante estes testes.
- Atualização: harness de UI verifica Sim/Não, oferta uma vez por sessão, obrigatoriedade e retomada; API verifica URL/digest oficial, autorização, histórico e compatibilidade. Esses testes não são uma instalação em telefone.
- Motor Windows real: inicializa o codec e aceita TX/RX 260%, rejeita 261% e aceita controle antigo de 130%, sem abrir áudio ou transmitir.
- JVM/UDP local: ODTP inscreve/cancela sem PTT nem TG4000, RX antes de PTT, reconexão, proteção RX+500ms e ciclo de saída rápida. Seletor mantém posições em 120 atualizações de atividade.
- Compilação e assinatura não comprovam qualidade acústica em aparelho real. **Pendentes**: instalação sobre APK anterior em telefone, percepção do volume em TX/RX, sessão em dois aparelhos reais, permissões/instalador do fabricante, Bluetooth e recepção na BrandMeister. Nenhum aparelho ADB estava conectado.
- Push externo depende do projeto Firebase ainda não fornecido. Teste local usa adaptador OAuth/FCM simulado, sem chamadas externas.
