# Car Preview 10 — cabeçalho Android e SCAN compacto

Prévia Android para teste, sem publicação. Versão 1.5.3-car-preview.10, código 15310. Mesmo pacote br.radio.zapdmr.carpreview e assinatura das anteriores. Instalar sobre a Preview 09 sem desinstalar ou limpar dados.

## Causa da sobreposição
A Preview 09 adicionou viewport-fit=cover. O SystemBars da versão do Capacitor utilizada, em WebViews recentes (>=140), detecta essa opção e deixa os insets chegarem à página sem aplicar padding nativo superior. O cabeçalho normal não reservava esse espaço; portanto podia ficar sob relógio, notificações e bateria, como na captura do operador.

Foi removido viewport-fit=cover para restaurar o tratamento nativo anterior de barras de sistema e recortes. A verificação foi feita no código local de node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java, em initWindowInsetsListener(). Nenhuma biblioteca nem Java do aplicativo foi modificado.

## Interface
- No celular, removidos o título OPERAÇÃO DE VOZ/TalkGroup ativa e a explicação extra do cartão de recepção, que antes apareciam conforme a altura disponível.
- Uma faixa compacta: SCAN, estado atual e seletor DMR/XLX. O texto longo fica visualmente abreviado para não aumentar a altura; seu conteúdo completo continua no DOM para acessibilidade. O título do botão explica que tocar inicia ou para o scan.
- Mantida a barra inferior com PTT, Modo Carro, Ligação e Definições.
- Mantidos os critérios, dados e rolagem da rodada. Na simulação 360×760, a área da rodada aumentou de 234,1px na Preview 09 para 314,6px; cinco linhas ficaram visíveis na captura.

## Testes
- Entrada 10: quatro atalhos, ausência de viewport-fit=cover, SCAN, ocultação da explicação/cabeçalho extra e contrato do SystemBars: passou.
- Controlador Car: configurações, conexão e listas de participantes preservadas; PTT, VOX e ganho: passou em simulação.
- Compilação e 24 testes JVM: passaram, zero falhas/erros.
- Navegador: 320×640, 360×760, 412×892 e 740×360, com fonte normal/ampliada e 20 participantes. Faixa SCAN com 36px, sem sobreposição entre texto/DMR/XLX e sem rolagem horizontal. Marca e controles superiores não se cruzaram. Rodada permaneceu acima da barra inferior.
- Captura em images/car-preview-10.png: simulação local, cinco participantes fictícios; sem conexão de rádio. Console da página direta sem erros na revisão final.

Limite da validação: nenhum aparelho ADB conectado. A correção da causa foi conferida no código do Capacitor, mas o resultado na barra de status Android deve ser confirmado no telefone do operador. Fonte ampliada do navegador não substitui todos os ajustes de acessibilidade de cada Android.

## Preservação
Motor DMR/XLX, perfis, credenciais, Bluetooth/MyLink, PTT, ganho 260% e faixa até 300%, VOX, scan, reconexão, ZapChat e atualizadores não foram alterados. Artefatos anteriores mantidos. Não houve publicação.

## Conferir no celular
1. Instale sobre a Car Preview atual, sem desinstalar.
2. Verifique que relógio/bateria ficam na barra Android e ZapDMR abaixo, sem se cruzarem.
3. Confira a faixa SCAN única, com DMR/XLX à direita, sem a explicação extra.
4. Toque na faixa para usar o scan como antes. Verifique perfil, TG, áudio e rodada.
5. Entre/saia do Modo Carro e visite as outras abas. Envie captura se qualquer elemento continuar sobreposto.
