# Áudio Android e relay HBP

## Caminho do áudio

O APK usa o plugin Capacitor `MobileAudioPlugin` para pedir `RECORD_AUDIO`, capturar PCM16 mono a 8 kHz em blocos de 160 amostras (20 ms) e reproduzir os blocos RX com `AudioTrack`. A senha do hotspot e o token WSS são guardados cifrados com AES/GCM e uma chave no Android Keystore.

O telemóvel envia os blocos PCM pelo WebSocket seguro `/mobile-ws`. No computador gateway, o relay autentica o token, arma o PTT HBP apenas após o comando explícito do utilizador, passa PCM ao `ZapDMRAudio.exe`, agrega os codewords AMBE no gateway atual e transmite DMRD. No RX, o gateway extrai AMBE, o vocoder descodifica para PCM e o relay envia os quadros ao telemóvel. A libertação do botão PTT interrompe captura e desarma o HBP.

O APK não contém o servidor HBP nem o vocoder. O gateway precisa de correr num Windows com `ZapDMRAudio.exe`, os assets licenciados do vocoder e um perfil BrandMeister válido. A UI do Android envia esse perfil ao gateway apenas dentro da sessão WSS/TLS; a senha no telemóvel fica protegida pelo Keystore.

## Configurar um gateway acessível

1. No computador Windows, configure `ZAPDMR_MOBILE_RELAY_TOKEN` com um token aleatório de pelo menos 32 bytes, `ZAPDMR_PORT` com uma porta estável (por exemplo `4173`), `ZAPDMR_AUDIO_SIDECAR_EXE` com o caminho do auxiliar e `ZAPDMR_AUDIO_ASSETS_DIR` com a pasta dos assets do vocoder.
2. Compile o servidor com `npm.cmd run build:server` e arranque `npm.cmd start`. Por segurança, ele escuta em `127.0.0.1` por omissão. A API HTTP local continua bloqueada para clientes remotos.
3. Publique apenas `/mobile-ws` através de um proxy reverso que termine TLS (WSS) e encaminhe o upgrade WebSocket para `127.0.0.1:4173`. Se o proxy enviar `X-Forwarded-Proto: https`, defina `ZAPDMR_MOBILE_TRUST_PROXY=1` e confie somente num proxy local controlado por si. Não exponha o restante painel/API, não use `ws://` e não encaminhe a porta UDP do BrandMeister pela Internet.
4. No APK, abra **Definições → Servidor**, informe `wss://seu-dominio/mobile-ws`, o token e os dados do perfil, incluindo a Hotspot Security Password, e guarde. Depois use **Ligação** para ligar e mantenha o PTT premido durante a transmissão.

O caminho completo requer rede móvel/Wi-Fi com acesso ao domínio WSS, certificado TLS válido, token igual nos dois lados, auxiliar/vocoder prontos no gateway e autorização BrandMeister. O serviço não cria um relay público automaticamente; é necessário alojá-lo e proteger o domínio e o token.

## Formato do relay

- Primeiro comando: `{"type":"auth","token":"…"}`.
- Ligação: `{"type":"connect","settings":{…},"password":"…"}`.
- PTT: `ptt-start` com `talkgroupId` e `slot`, quadros binários de exatamente 320 bytes por 20 ms, seguido de `ptt-stop`.
- RX: o servidor envia os mesmos quadros PCM16 binários de 320 bytes.

Uma ligação móvel controladora é permitida de cada vez. O endpoint exige WSS, token de pelo menos 32 bytes e gateway Windows com o vocoder pronto. A conexão de controlo local existente `/ws` permanece restrita a loopback.
