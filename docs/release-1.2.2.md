# ZapDMR 1.2.2 — recepção e avisos

- Toast: 3 segundos, fade-out, sem interceptar toques; posicionado abaixo do cabeçalho, livre da navegação e de Guardar.
- Android: foco de áudio pertence ao serviço de rádio. Volta a reproduzir ao recuperar foco; a rota só muda quando a opção Bluetooth muda. Habilitar botão Bluetooth sem acessório SCO não muda a saída para o auricular de chamadas.
- Android: falha de um quadro do vocoder não encerra HBP; o helper pode ser recriado no quadro seguinte. Erros RX aparecem com limitação de frequência.
- Windows: falha de captura do microfone não derruba o renderizador RX; recepção pode continuar pronta, enquanto PTT permanece indisponível sem captura.
- Guardar definições e mudar de aba não enviam PTT nem reconectam a sessão de rádio.

Validação: compilação do servidor, Java Android e auxiliar C++; assinatura e integridade dos recursos do APK. A recepção audível e os acessórios precisam de confirmação em hardware. Não foi feita transmissão de teste no master.

A seleção passiva não cria uma subscrição dinâmica no BrandMeister: apenas áudio encaminhado ao hotspot pelo master pode ser ouvido. O Last Heard global indica atividade, mas não transporta o áudio dessas TGs.
