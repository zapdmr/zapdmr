# ZapDMR

Aplicação desktop e interface Capacitor para consultar TalkGroups brasileiros e estabelecer uma sessão HBP UDP com um master BrandMeister. A identidade visual é própria, com paleta verde, temas automático/claro/escuro e preferências locais.

## Estado funcional

- Catálogo brasileiro: 44 TalkGroups importados do PDF fornecido, com busca, categorias, slot e favoritos.
- Perfil: indicativo, Radio ID de 7 dígitos, ESSID de 2 dígitos, master, TG escolhida e tema. O ID usado no login é `Radio ID + ESSID` (9 dígitos).
- HBP: envia `RPTL`, responde ao desafio `RPTACK` com `RPTK` (`SHA-256(salt + password)`), envia `RPTC`, mantém a sessão com `RPTPING`, reconhece rejeição/encerramento do master e fecha com `RPTCL`.
- Voz DMR: o Electron inicia `ZapDMRAudio.exe` pelo Named Pipe local; o sidecar captura/reproduz PCM e troca codewords AMBE de 9 bytes com o servidor. O Node agrupa três codewords em slots DMR de 33 bytes, gera sincronismo EMB e cabeçalho/terminador Full LC com BPTC(196,96), e encaminha os DMRD ao master. No RX, extrai os codewords para decodificação pelo sidecar.
- PTT: arma e desarma a TG selecionada; só fica disponível depois da prontidão do vocoder e dos endpoints de captura e reprodução. O gateway também aceita quadros `DMRD` completos de 55 bytes ou com extensão trunking de 71 bytes, valida Radio ID/ID de hotspot/TG/stream/sequência e encaminha o datagrama UDP ao master.
- Tema: seleção automática, clara ou escura, com preferência persistida no `localStorage` e transição suave.
- Segurança: a Hotspot Security Password fica apenas na memória do servidor e não é gravada em `settings.json`. A API escuta apenas em `127.0.0.1`.

### Preparação do áudio

O instalador inclui `ZapDMRAudio.exe`, os componentes nativos do vocoder e as cópias de `D002.032.bin` e `d02032-core.img` fornecidas e autorizadas pelo responsável. Os arquivos são instalados no primeiro arranque e podem ser restaurados por **Ativar / Reparar vocoder**, a partir dos assets locais, sem internet. Não é necessário copiá-los manualmente para começar. O aplicativo inicia o sidecar automaticamente e indica no estado do sistema quando captura e reprodução estão prontas. Os dados de firmware permanecem separados do código GPL e dos respectivos avisos de distribuição.

O framer DMRD Node foi conferido com os formatos e códigos de canal publicados pelo MMDVM-Host. Ainda falta validação de interoperabilidade com captura de RF e transmissão BrandMeister ao vivo. Além disso, o próprio sidecar documenta uma divergência entre a descrição pública da ABI `qdv_*_fec` e as tabelas de bits vendorizadas; confirme essa ABI antes de usar a transmissão em operação.

## Estrutura

```text
ZapDMR/
├── assets/ZapDMR.ico
├── assets/icon.png           # fonte Android 1024×1024 derivada do ícone recebido
├── data/talkgroups-brasil.json
├── electron/                 # janela desktop e configuração do Forge
├── scripts/                  # scripts PowerShell para Windows e Android
├── src/server/               # API, WebSocket, HBP/UDP e relay DMRD
├── web/                      # interface, estilos, catálogo e PNG
├── capacitor.config.json
├── package.json
└── tsconfig.server.json
```

## Executar no Windows

Requer Node.js 22 ou superior. No PowerShell, nesta pasta:

```powershell
npm install
npm start
```

O endereço local é mostrado no terminal. Para abrir a janela Electron em desenvolvimento:

```powershell
npm run desktop:dev
```

O servidor escuta apenas em `127.0.0.1`. Em desenvolvimento, as definições ficam em `data/settings.json`; no aplicativo instalado, em `%APPDATA%\ZapDMR` (diretório userData do Electron). A senha do hotspot é apagada ao fechar o processo.

## Gerar o instalador Windows

Requisitos: Windows x64, Node.js 22+, acesso npm e Visual Studio 2022 x64 com CMake. O script também compila o sidecar nativo se o executável ainda não existir. Execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

O Electron Forge gera `ZapDMR-Setup.exe` em `out/make/squirrel.windows/x64/`, além dos ficheiros de atualização Squirrel. É um instalador autónomo para o utilizador final (não exige Node instalado), mas não é um executável portátil único. Para distribuição pública, assine o instalador com um certificado Authenticode.

## Gerar o APK Android

Requer Node.js 22+, JDK 21, Android SDK API 36, NDK 27 ou superior, CMake/Ninja e Boost 1.88. O SDK pode ser indicado em `android/local.properties`. O Gradle usa um cache isolado em `.gradle-user-home`. Execute no PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-android.ps1
```

O script compila os vocoders ARM64/ARMv7, sincroniza `web/`, executa `assembleRelease` e assina o APK com a chave local em `.android-signing`. Guarde uma cópia privada dessa pasta para assinar as próximas atualizações. O APK fica em:

```text
release/ZapDMR-Android-1.3.1.apk
```

Para abrir o projeto nativo no Android Studio: `npm run android:open`. Para gerar uma versão de depuração, acrescente `-DebugApk` ao script.

O APK inclui o serviço Android HBP/UDP, captura/reprodução nativa e os helpers GPL do vocoder. Este APK local inclui as cópias verificadas de `D002.032.bin` e `d02032-core.img` do projeto e instala-as automaticamente no primeiro arranque, sem internet. O botão Ativar / Reparar vocoder restaura-as dos assets. Cada operador configura as próprias credenciais. Os dados de firmware são separados do código GPL. A validação de áudio real RX/TX requer o teste no dispositivo Android; veja `docs/android-standalone-architecture.md`.

## Comunidade, WhatsApp e confirmação do número

A versão 1.3.1 inclui o fluxo de confirmação de WhatsApp no site e na ativação do perfil: código de seis dígitos, validade de dez minutos, reenvio após 60 segundos, até cinco tentativas e opção de corrigir o número. O download pelo portal e a criação da sessão do ZapChat exigem confirmação. A API aceita envio por adaptador HTTPS, entrega pela ponte local WhatsApp ou confirmação reversa por mensagem recebida de um remetente validado.

Em 20/10/2026, o código e os instaladores 1.3.1 estão preparados; a ponte local está aberta com QR e aguarda o responsável vincular o WhatsApp oficial. Isso ainda não comprova entrega real de um código ou validação de cadastro em produção. Não há código mestre em produção. A homologação visível fica restrita ao servidor Node local com banco separado.

Consulte [o fluxo e a configuração de OTP](site/WHATSAPP-OTP.md), [a arquitetura de autenticação](site/AUTENTICACAO.md) e [o registro de 20/10/2026](site/VERIFICACAO-2026-10-20.md). O login HBP do rádio usa credenciais próprias e não envia telefone, código OTP ou token da comunidade ao master.

## Configurar o master

1. Defina o hotspot security password no BrandMeister SelfCare para o Radio ID utilizado.
2. No ZapDMR, preencha indicativo, os 7 dígitos do Radio ID, um ESSID de 00 a 99, master e senha.
3. Guarde o perfil e escolha **Ligar ao master**. O porto UDP HBP padrão é `62031`.
4. Se a autenticação completar, o estado muda para Ligado. Escolha uma TG e arme o PTT.

As instruções oficiais da BrandMeister descrevem o Radio ID de 7 dígitos, o ESSID e a Hotspot Security Password. O código público oficial DMRHost documenta as mensagens HBP usadas pelo gateway:

- [BrandMeister: Connecting Hotspots](https://help.brandmeister.network/hotspots/connecting-hotspots/)
- [BrandMeister: Hotspot Security](https://help.brandmeister.network/dashboard/hotspot-security/)
- [BrandMeister DMRHost: DMRNetwork.cpp](https://github.com/BrandMeister/DMRHost/blob/dev/DMRNetwork.cpp)
- [Electron Forge: Squirrel.Windows](https://www.electronforge.io/config/makers/squirrel.windows)
- [Capacitor: configuração do ambiente](https://capacitorjs.com/docs/getting-started/environment-setup)


## Atualização 1.4.0

ZapChat com clipe, prévia, imagens e documentos privados até 15 MiB. Conversas isoladas por contacto, reabertura e confirmações de leitura corrigidas. Seleção de TG passiva, sem burst automático, e recuperação de foco RX no Android. Consulte [a implementação e os limites](site/ZAPCHAT-ANEXOS.md).
