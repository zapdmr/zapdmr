# Car Preview 07 — relatório de testes

Prévia Android isolada, sem publicação. Pacote br.radio.zapdmr.carpreview, versão 1.5.3-car-preview.7, código 15307. Instalar sobre a Car Preview anterior, sem desinstalar. Não substitui o aplicativo estável.

## Ganho e VOX
Ganho TX de 0% a 300%, padrão novo 260%, ajustes existentes preservados e limitador suave. RX inalterado. O relato de qualidade satisfatória a 260% em DMR/XLX corresponde ao teste real do operador na Preview 06.

VOX experimental desligado por padrão e não reativado automaticamente. Sensibilidade baixa/média/alta, silêncio de 0,4 a 3 segundos (padrão 1,2). WebRTC VAD, calibração inicial de silêncio, histerese e rejeição de ruído constante. Bloqueio durante RX e espera acústica adicional de 1,2 segundo. TOT até 180 segundos, respeitando limites menores. Desconexão, troca de destino/dispositivo, saída de tela ou falta de resposta da interface desligam o VOX. Botão PARAR VOX visível. PTT manual selecionável entre tocar e segurar; padrão tocar preservado.

O início de palavras curtas pode ser perdido pela qualificação de 200–320 ms e passagem do monitor para o transmissor. VAD não identifica o dono da voz: outra pessoa ou televisão pode disparar TX. AEC/NoiseSuppressor só são habilitados quando disponíveis; isso não comprova cancelamento acústico no veículo. Bluetooth de saída não comprova microfone Bluetooth.

## Resultados
- Compilação Android ARM64/ARMv7: passou.
- JVM: CarModeState (2), CarTxGain (4), CarVoxGate (7), sem falhas.
- Ganho numérico em 100/180/260/300%, limitador e preservação da cadeia normal: passou.
- VAD nativo C + JNI + política Java com áudio público de referência e silêncio: passou. Não utilizou microfone nem rede real.
- Interface, ganho salvo 155%, sensibilidade, VOX opt-in, desligamento rápido, retorno manual e PTT tocar/segurar: passou em simulação.
- RX, ruído constante, silêncio, lease e TOT: passaram nos testes de política.
- ODTP e XLX: passaram contra servidores UDP locais isolados; não são validação de áudio em master público.
- Qualidade real DMR/XLX desta prévia, microfone do celular, Bluetooth, eco, central do carro, reconexão física e TOT em aparelho: pendentes. Nenhum aparelho estava conectado por ADB.

Comandos reproduzíveis: scripts/validation/car-ui.test.cjs, car-entry07.test.cjs, car-scan.test.cjs, quick-exit.test.cjs, open-terminal.test.cjs, xlx-session.test.cjs e vox-native07.ps1. Build: scripts/build-car-preview.ps1.

## Como testar
Com veículo estacionado, abra Car Preview 07, entre no Modo Carro e conecte seu perfil. Confirme a TG, pare o scan e aguarde rádio livre. Em Ajustes, mantenha inicialmente 260%, sensibilidade média e silêncio 1,2 s. Ative VOX nesta sessão e aceite o uso do microfone. Faça silêncio para calibrar. Fale, confirme encerramento por silêncio e use PARAR VOX para voltar ao manual. Teste primeiro com celular e depois com Bluetooth, verificando a entrada real. Peça avaliação de áudio a outro operador. Verifique bloqueio durante RX e retorno acústico. Faça testes prolongados/TOT apenas em destino autorizado para testes.

## Fontes e limitações
WebRTC VAD fixado em e283ca41df3a84b0e87fb1f5cb9b21580a286b09: https://github.com/wiseman/py-webrtcvad . Licenças incluídas no código e APK. Efeitos Android: https://developer.android.com/reference/android/media/audiofx/AcousticEchoCanceler e https://developer.android.com/reference/android/media/audiofx/NoiseSuppressor .

Windows: núcleo compilado somente para diagnóstico offline; VOX ainda não integrado ao aplicativo Windows. Nenhuma publicação ou atualização das versões estáveis/candidatas anteriores.
