# Car Preview 08 — diagnóstico Bluetooth MyLink

Prévia exclusiva para testes, sem publicação. Continua o ganho/VOX da Preview 07; pacote br.radio.zapdmr.carpreview, versão 1.5.3-car-preview.8, código 15308. Atualiza as Car Preview anteriores sem desinstalar. Aplicativo estável e perfis preservados.

## Causa encontrada
No código anterior, a solicitação de comunicação considerava somente a saída escolhida. Escolher uma entrada Bluetooth não estabelecia necessariamente HFP/SCO; com ambos em Padrão do Android, nenhuma seleção explícita era feita. Isso é uma causa provável do uso do microfone do telefone, ainda sem comprovação física no Cruze.

## Correções
- Android 12+: entrada Bluetooth é associada ao dispositivo de saída elegível de getAvailableCommunicationDevices(); MODE_IN_COMMUNICATION e setCommunicationDevice(). Verificação por getCommunicationDevice() e OnCommunicationDeviceChangedListener. Não confunde retorno true com captura comprovada.
- Android anterior: SCO legado somente nessa faixa, com ACTION_SCO_AUDIO_STATE_UPDATED para verificar conexão.
- Solicitação com prazo de 4 segundos; falha restaura o padrão e permite microfone do celular. Reconexão tenta uma vez por evento de dispositivo, sem loop infinito. Preferência por nome/tipo permanece salva, IDs são redescobertos.
- AudioRecord continua sendo o único capturador do motor existente. getRoutedDevice() é verificado antes do primeiro cabeçalho TX do Modo Carro e durante os quadros seguintes. Entrada diferente da solicitada interrompe/bloqueia TX. VOX usa a mesma verificação.
- Interfaces tipo 18 (telefonia) e 25 (remote-submix, virtual) aparecem no diagnóstico, mas não são oferecidas como microfones físicos. Tipo 15 é microfone integrado e tipo 7 Bluetooth SCO. A2DP não é microfone.
- O teste local mostra solicitado, comunicação escolhida pelo Android, entrada de captura, medidor, gravação de 3 segundos e reprodução. Não envia PTT, cabeçalho ou voz ao master. Gravação fica apenas em memória e é descartada ao terminar; não é enviada nem salva em arquivo.
- 260% padrão/ajustes 0–300%, limitador, RX, DMR/XLX, interface principal e PTT manual mantidos.

## Limitações
SCO/HFP seleciona entrada e saída em par: pode alterar qualidade/volume do RX comparado a A2DP. Não há promessa de manter A2DP estéreo com microfone HFP simultaneamente. Se a central não oferecer o microfone ao Android, a alternativa é saída padrão/A2DP com microfone do celular. Um nome na lista, emparelhamento ou confirmação de comunicação não prova voz captada pelo microfone do teto.

## Validação no Cruze estacionado
1. No Bluetooth do telefone, confirme MyLink conectado e a opção de chamadas habilitada, se oferecida. Não exige Android Auto/Carlink.
2. Abra Car Preview 08 → Modo Carro → Ajustes → Consultar áudio e Bluetooth. Autorize dispositivos próximos e microfone quando solicitado.
3. Selecione Microfone Chevy MyLink (Bluetooth SCO/HFP); deixe saída Padrão do Android inicialmente. Essa escolha solicita o par HFP/SCO. Guarde e aguarde confirmação. Não ative VOX ainda.
4. Abra Ajustes → TESTAR MICROFONE DO CARRO. Autorize gravação local. Fale perto do microfone da central, com celular afastado; observe medidor e escute reprodução. Compare com Microfone integrado, falando perto do celular. Nunca cubra ou manipule o aparelho em movimento.
5. Capture a tela com solicitado / comunicação Android / entrada real e informe se ouviu a voz. Entrada real deve identificar Bluetooth SCO do MyLink. Resultado não verificado/recusado significa que não foi confirmado.
6. Teste RX, DMR e XLX com colega autorizado, PTT tocar e segurar, soltar/cancelar, desconectar/reconectar MyLink, desligar/ligar central e voltar ao Modo Normal. Verifique se nenhum TX fica preso.
7. Se falhar, selecione entrada e saída Padrão do Android, guarde e repita com celular. RX padrão é a alternativa funcional. Não altere seu ganho aprovado sem necessidade.

## Testes e evidência
Testes automatizados e detalhes finais constam no arquivo de resultados junto deste relatório. Sem aparelho ADB conectado durante o desenvolvimento. RX/TX físicos no MyLink, HFP real, retomada após desligar central, outros Bluetooth e qualidade de voz são PENDENTES. A correção não é declarada aprovada em veículo.

## Fontes oficiais
- Seleção de comunicação e par de entrada automático: https://developer.android.com/reference/android/media/AudioManager#setCommunicationDevice(android.media.AudioDeviceInfo)
- Tipos e papéis de dispositivo: https://developer.android.com/reference/android/media/AudioDeviceInfo
- Captura efetiva: https://developer.android.com/reference/android/media/AudioRecord#getRoutedDevice()

## Arquivos principais
CarAudio.java, CarAudioTypes.java, CarModePlugin.java, RadioSessionService.java, web/car-mode.js, recursos de identificação da prévia e testes. O motor de vocoder, protocolo e perfis não foi substituído. Nada foi publicado no site.
