# ZapDMR Android 1.4.5 — Saída rápida

Versão Android 1.4.5 / código 18, aprovada pelo responsável para publicação. Esta entrega ajusta o botão de energia da 1.4.4. O instalador Windows permanece na 1.4.3.

## Comportamento

1. O botão ⏻ abre **Deseja desconectar e fechar o ZapDMR?**, com **Cancelar** e **Sair**, mesmo quando já desconectado.
2. Durante TX ou seu encerramento, a interface e o serviço recusam a saída: **Encerre a transmissão antes de sair.** Um teste local de áudio também deve terminar antes da saída.
3. A confirmação interrompe RX, desabilita a intenção de reconectar somente em memória, cancela callbacks e trabalhos de troca de TG, envia o cancelamento ODTP e fecha a sessão. Não envia TG 4000 ou voz de ativação.
4. O serviço fecha socket, vocoder, microfone/VOX, reprodução, foco/rota de áudio, Bluetooth/SPP, MediaSession, monitor de rede, wake lock e notificação. Tons pendentes são liberados. APRS/GPS independentes são desconectados ao fechar o aplicativo, sem apagar sua configuração.
5. Só depois de `onDestroy` confirmar a limpeza, a ponte executa `finishAndRemoveTask()`. Não usa `killProcess`, `System.exit` ou encerramento forçado do processo. O Android pode manter o processo em cache, mas a sessão de rádio permanece encerrada.
6. Comandos de conexão/PTT atrasados e retorno tardio do DNS ficam barrados. Eventos de uma instância destruída não alteram a tela ou reabrem a notificação.
7. Uma marca privada e sem credenciais (`resume_after_quick_exit`) permite a retomada na próxima abertura. Ela não muda `autoConnectOnStartup` nem `autoReconnect` salvos, inclusive quando a conexão automática estava desmarcada. A retomada é consumida uma vez; as aberturas seguintes seguem a preferência original.
8. O último perfil, protocolo, master, porta, TG e senha protegida são reutilizados. Se faltarem dados, a interface lista o que completar. Falhas de permissão são informadas; falhas de rede seguem a política de reconexão existente.
9. A retomada após saída rápida começa em escuta. Não envia PTT automaticamente; se VOX estava salvo como ligado, sua configuração é preservada, mas o monitor só volta após o primeiro PTT aceito por ação do operador nessa sessão. Isso evita transmitir ruído ambiente ao reabrir.

O botão normal **Desligar/Ligar ao master**, na aba Ligação, permanece separado da Saída rápida. O comportamento de desconexão no Windows não foi alterado nesta entrega.

## Arquivos

- `web/participant-actions.js`: somente a parte do botão de energia.
- `web/mobile-audio.js`: chamada de saída, marca de retomada e barreira contra conexão concorrente.
- `web/app.js`: decisão de conexão na abertura e mensagens para dados ausentes.
- `android/app/src/main/java/br/radio/zapdmr/QuickExitState.java`: novo estado de ciclo de vida, testável em JVM.
- `RadioSessionService.java`, no mesmo diretório: saída segura, bloqueio de tarefas atrasadas e confirmação após limpeza.
- `MobileAudioPlugin.java`: coordenação da resposta nativa, fechamento da tarefa e leitura da marca de retomada.
- `MainActivity.java`: liberação da barreira em nova abertura; espera pela limpeza caso uma abertura concorra com a saída.
- `OpenTerminal.java`: somente a identificação de versão enviada no keepalive.
- `android/app/build.gradle`, `package.json`, `package-lock.json`: versão 1.4.5.
- `scripts/validation/QuickExitStateTest.java`, `quick-exit.test.cjs`, `participant-actions.test.cjs`: testes de saída/retomada e atualização do mock nativo.
- `docs/PADROES-DE-RADIO.md` e este relatório.
- Recursos web do APK sincronizados pelo Capacitor.

## Verificações automatizadas

- JVM: TX recusa saída sem mudar estado; RX/repouso pode sair; pedidos duplicados; nova abertura durante limpeza; bloqueio enquanto fechado; liberação na próxima abertura; cancelamento antes da limpeza se não conseguir salvar a marca.
- Interface e ponte JavaScript reais em harness: textos, Cancelar sem efeitos, sair já desconectado, RX não impede saída, segunda conferência de TX, espera pela resposta nativa, preservação do perfil/master/TG e preferências, retomada uma vez, dados ausentes, erro de permissão e bloqueio de conexão concorrente.
- Contratos de integração nativa: remoção de callbacks, encerramento de rede/serviço/notificação, pedido/resposta correlacionados, fechamento somente após sucesso e ausência de encerramento forçado.
- Regressões da 1.4.4: ReceiveGuard (500 ms, renovação, expiração e pacotes HBP/ODTP), protocolo ODTP, menu/identidade ZapChat, seletor de TG estável durante 120 atualizações e catálogo.
- Comparação com o pacote de fontes da 1.4.4 para os módulos que não deveriam mudar: bloqueio de RX, controles de operação, catálogo, estilos e ZapChat.
- Build Android release, assinatura v2/v3, alinhamento e correspondência entre recursos do APK e fontes. SHA-256 em `release/ZapDMR-Android-1.4.5.sha256`.

## Testes em aparelho real

Nenhum teste em celular físico foi realizado nesta tarefa. Os testes de fechamento/reabertura e liberação de recursos Android combinam harness/JVM, inspeção dos vínculos nativos e compilação; não substituem observar um telefone real.

Antes da divulgação geral: instalar sobre a versão anterior; sair ouvindo outra estação; conferir remoção da notificação; reabrir e ouvir a mesma TG; verificar recusa durante TX; testar sem internet e voltar à rede; repetir com Bluetooth/SPP e APRS ativos.
