# Resultados automatizados — Car Preview 08

- Compilação Android: verificar work/car-preview-08-delivery-build.log no ambiente de desenvolvimento.
- JUnit: 24 testes, zero falhas/erros (inclui 4 de classificação Android, 4 de ganho, 7 da política VOX, 2 de estado Car e 7 testes existentes).
- Interface simulada: configurações preservadas, 260% padrão, 155% personalizado preservado, PTT tocar/segurar, VOX voluntário, desligamento rápido e retorno manual. Teste local aplica a rota, mostra entrada/medidor e não inicia PTT.
- Entrada principal Preview 08, scan sequencial e saída rápida: passaram.
- ODTP e XLX: passaram em servidores UDP isolados. Não houve transmissão em rede pública.
- WebRTC VAD + JNI + Java: teste offline aprovado na Preview 07; código VAD inalterado na 08.
- Conferência final de versão, assinatura, bibliotecas ARM e correspondência dos arquivos web realizada na preparação do APK.

PENDENTES: MyLink real, captura do microfone do teto, RX/TX físicos DMR e XLX da nova prévia, reconexão/desligamento da central, comparação de qualidade e outros Bluetooth. Sem aparelho conectado por ADB. O usuário confirmou que fará o teste estacionado. Não declarar aprovação do microfone do veículo antes disso.

