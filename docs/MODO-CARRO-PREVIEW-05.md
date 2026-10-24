# Car Preview 05 — tela única e PTT por toque

Candidata Android de teste, pacote br.radio.zapdmr.carpreview, versão 1.5.3-car-preview.5, código 15305, nome ZapDMR Car Preview 05. Atualiza a prévia 04 com a mesma assinatura e preserva os dados dela. Não publica nem substitui o aplicativo estável.

O usuário confirmou que abriu a prévia 04 e o painel funcionou. Os testes no veículo ainda estão pendentes. Nesta 05, a interface do Modo Carro ocupa uma única área de tela, com favoritos em janela sobreposta. Ajustes e TG rápida continuam em janelas próprias. A interface normal permanece como antes.

PTT da tela: primeiro toque inicia, segundo toque encerra. A soltura normal do dedo não encerra mais a transmissão. Mantém confirmação de destino, bloqueio RX, proteção após RX, desconexão e TOT do perfil. Cancelamento de toque, perda de foco/segundo plano e perda de Bluetooth encerram TX; um heartbeat evita TX preso se a interface parar de responder. O evento nativo de fim/TOT também limpa o estado do botão. O PTT externo SPP permanece com comandos próprios de pressionar e soltar.

Validação: car-ui confirma primeiro/segundo toque, cancelamento, foco, perda SPP, reconectar sem TX e preservação de preferências normais. car-entry05 e car-scan passaram. Compilação e testes JVM passaram. Revisão visual no navegador em áreas de 390×780 e 360×640 mostrou todos os controles principais dentro de uma tela. Isso não substitui teste da WebView, escala de fonte e navegação do telefone real.

Para instalar: abrir o APK 05 sobre a prévia existente, sem desinstalar. Conferir nome Preview 05, abrir aba PTT, tocar ATIVAR MODO CARRO. Configurar/confirmar o destino; testar toque para iniciar e toque para parar com outro operador e veículo estacionado. Verificar o bloqueio durante RX, cancelamento ao trocar de app e manutenção de áudio. Confirmar que todos os controles ficam visíveis no próprio telefone. Não usar a tela enquanto dirige.

Nenhuma alteração publicada no site. Versões estáveis e candidata 1.5.3 original preservadas.
