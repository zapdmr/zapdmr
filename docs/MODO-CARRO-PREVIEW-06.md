# Car Preview 06 — ganho de transmissão no celular

Candidata Android de teste: ZapDMR Car Preview 06, 1.5.3-car-preview.6, código 15306, pacote separado br.radio.zapdmr.carpreview. Não publicada. Layout principal idêntico ao aprovado na 05; PTT por toque e tela única preservados.

## Alteração
Em Ajustes do Modo Carro há Ganho do microfone TX, de 0 a 260%. O valor inicial é pelo menos 130%; se o perfil normal já usava ganho maior, ele é respeitado ao iniciar sem preferência própria do carro. Depois de guardar, a preferência do Modo Carro é independente. Não há regravação do ganho do perfil normal nem alteração de volume RX ou de Bluetooth.

O mesmo processamento é usado na transmissão real antes do vocoder e na gravação/reprodução de teste. Um limitador suave atua nos picos acima de 28000 unidades PCM e limita a saída aproximadamente a 32500, evitando o corte digital abrupto. Isso não corrige distorção já produzida pelo microfone nem comprova qualidade percebida. O modo normal conserva a multiplicação inteira e saturação anteriores.

## Como comparar
Instalar sobre a prévia anterior, sem desinstalar. Abrir Modo Carro → Ajustes → Ganho do microfone TX. Começar em 130%, guardar, reabrir Ajustes e usar Testar microfone. O teste é local, exige consentimento/permissão e não transmite. Se ainda estiver baixo, comparar 150% ou 180% e guardar. Conferir com outro operador usando a mesma distância do microfone. Reduzir se a voz perder clareza. Usar o veículo estacionado. Volume RX regula o que se ouve, não o que se transmite.

## Evidência
CarTxGainTest: 3 testes passaram — ganho de voz baixa em +30%, mute, limites dos picos e preservação matemática do ganho normal. car-ui e car-entry06 passaram, incluindo preservação das preferências e PTT por toque. APK compilado e arquivos finais conferidos. Não houve captura do microfone físico nem transmissão real nesta etapa; o usuário ainda deverá comparar o nível recebido. O teste no veículo continua pendente.

Versões estáveis, candidata 1.5.3 original e APKs de teste 04/05 preservados. Nenhuma atualização do site.
