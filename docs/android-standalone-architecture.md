# ZapDMR Android autónomo

## Arquitetura incluída

```text
Interface Capacitor
  └─ MobileAudioPlugin (perfis cifrados, SAF, eventos, PTT)
       └─ RadioSessionService (Foreground Service, UDP/HBP, keep-alive, reconexão)
            ├─ DmrFrameEngine (LC, BPTC, slot type, EMB e AMBE)
            ├─ AudioRecord / AudioTrack (PCM16 mono, 8 kHz)
            └─ VocoderHelper (processo GPL separado, IPC por stdin/stdout)
```

O aplicativo móvel não usa o servidor Node do Windows nem `ZapDMRAudio.exe`. O
serviço nativo autentica por HBP, recebe e envia DMRD, mantém a sessão em primeiro
plano e volta a tentar a ligação com espera progressiva. Escolher uma TG apenas
altera o destino local da escuta/PTT; não envia pacote DMRD. A senha é cifrada
com Android Keystore. No primeiro arranque, FirmwareBundle instala os dois
firmwares incluídos no APK na pasta privada, verificando tamanho e SHA-256.
Não é necessária rede nem importação manual para preparar os ficheiros de áudio.

## Vocoder e firmware

O código GPL-3.0 de `native/vocoder-android/vocoder-main` fornece o codec AMBE+2
e um helper em processo separado. `scripts/build-vocoder-android.ps1` compila o
helper Dynarmic para `arm64-v8a` e o helper de execução nativa para `armeabi-v7a`,
colocando os binários em `android/app/src/main/jniLibs/`.
O APK extrai as bibliotecas nativas para que o serviço execute o helper do
diretório privado permitido pelo Android.

Este APK local contém as cópias verificadas de `D002.032.bin` e `d02032-core.img`
encontradas em `assets/vocoder`, por solicitação do operador. O botão
**Ativar / Reparar vocoder · sem internet** repõe os dois ficheiros diretamente
dos assets. O helper também restaura recursos ausentes/corrompidos antes de iniciar.
As gravações usam AtomicFile e uma falha conserva o ficheiro anterior.

O motor ARM64 atual exige a imagem SRAM `d02032-core.img`; não é tratada como
opcional porque a inicialização depende dela. Ambos os recursos estão incluídos.
O Android não executa código do app no ato de instalar: a preparação ocorre ao
abrir o app pela primeira vez, ou quando o serviço de áudio precisa dos recursos.

O download HTTPS fica disponível apenas como alternativa avançada. Os links
diretos fornecidos para o BIN e para o core main/master retornaram HTTP 404 na
verificação de 19/10/2026; o ZIP original respondeu HTTP 200. Não se configuram
links conhecidos como indisponíveis nem se presume que um ZIP contém firmware já
desembrulhado. A ativação local independe desses servidores.

Para recompilar a partir do arquivo de fontes GPL, coloque as cópias do operador
em `assets/vocoder/D002.032.bin` e `assets/vocoder/d02032-core.img`. A tarefa Gradle
`prepareBundledFirmware` verifica os hashes e prepara os assets em toda compilação.
Os dados de firmware não integram o arquivo de fontes GPL; consulte os avisos
separados em `THIRD_PARTY_NOTICES.md`.

## Requisitos de compilação

- JDK 21, Android SDK (API 36), NDK 27 ou superior, CMake e Ninja;
- cabeçalhos Boost 1.88 ou superior (`BOOST_ROOT` aponta para a pasta com
  `boost/version.hpp`);
- Git e rede para o CMake obter Dynarmic, dependência do vocoder.

Os helpers ARM64 e ARMv7 foram compilados com o NDK 30.0.16248370. O NDK
27.0.12077973 também foi instalado e validado. O Gradle usa um cache isolado
em `.gradle-user-home` dentro do projeto.

## Estado e validação necessária

O código nativo implementa sessão HBP, codificação/descodificação de frames e
captura/reprodução. A validação de frames comparou os LC com o desktop e executou
2.000 ciclos de montagem/extração de AMBE. Ainda é necessário testar voz numa
instalação Android real, com firmware importado e credenciais válidas. A
compilação do APK não comprova a qualidade de áudio ou a ligação ao master no
telemóvel. O helper executa um autoteste de codec ao carregar o firmware.
