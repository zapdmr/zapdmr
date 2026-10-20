# Licenças e proveniência

## Bandeiras

As bandeiras SVG em `web/flags` são gráficos Twemoji por Twitter, Inc. e demais
colaboradores, obtidos de https://github.com/jdecked/twemoji e usados sob CC BY 4.0.
A arte não foi alterada; os nomes dos ficheiros foram convertidos para códigos
de país. A licença acompanha `web/licenses/Twemoji-CC-BY-4.0.txt`.

O ZapDMR é distribuído sob GNU GPL versão 3. Consulte `LICENSE`.

## Vocoder DMR para Android

O código-fonte em `native/vocoder-android/vocoder-main` deriva de
[`greyfoxsolid/vocoder`](https://github.com/greyfoxsolid/vocoder), commit
`d519d0cdfc41200a35a120c74512fd832152a729`, licenciado sob GPL-3.0. A árvore
inclui o código do codec, o helper IPC e as licenças dos componentes de terceiros;
consulte `native/vocoder-android/vocoder-main/NOTICE.md`.

O helper de codec é executado como processo separado. Este APK local inclui as
cópias de `D002.032.bin` e `d02032-core.img` já existentes no projeto, a pedido do
operador. Esses dados de firmware são separados do código GPL; a licença GPL do
ZapDMR não os relicencia nem concede direitos sobre firmware de terceiros.
O aplicativo verifica tamanho e SHA-256 antes de instalar as cópias na pasta
privada Android. Os binários de firmware não integram o arquivo de código-fonte GPL.

O build Android compila e inclui os helpers ARM64 e ARMv7 a partir deste
código-fonte GPL. As alterações de integração ao build permitem selecionar o
NDK instalado por ANDROID_NDK_HOME e usam o motor nativo específico para ARMv7.
O teste de áudio de ponta a ponta exige um dispositivo Android e firmware válido.

## Monitor global Android

O cliente de Last Heard utiliza Java-WebSocket 1.5.7, sob licença MIT, e a API
SLF4J, também MIT. Os avisos dessas bibliotecas acompanham os ficheiros de licença
do APK. O monitor é somente de leitura e não utiliza o socket UDP de rádio.

## LC DMR completo e embutido

As rotinas TypeScript e Java de LC embutido foram adaptadas/reimplementadas a partir da disposição e codificação do MMDVM-Host de Jonathan Naylor G4KLX. Copyright (C) 2015,2016,2017,2023,2025 Jonathan Naylor G4KLX. O upstream permite GPL versão 2 ou posterior; a integração ZapDMR é distribuída sob GPL-3.0. Alterações de integração: ZapDMR, 2026. Sem garantia.

Fontes: https://github.com/g4klx/MMDVM-Host/blob/master/DMREmbeddedData.cpp e https://github.com/g4klx/MMDVM-Host/blob/master/Hamming.cpp. A licença GPL-3.0 integral acompanha o projeto em LICENSE.
