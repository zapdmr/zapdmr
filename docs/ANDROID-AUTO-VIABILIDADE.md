# Android Auto — viabilidade

Esta candidata é uma interface no telefone Android. Não implementa projeção Android Auto nem foi aprovada pelo Google.

O Android Auto exige categorias suportadas, modelos de interface e critérios próprios. Não basta apresentar a tela do telefone. Comunicação contempla experiências de chamadas e mensagens; a elegibilidade de rádio PTT e sua distribuição devem ser confirmadas com os requisitos vigentes e o processo do Google. Não há garantia de aprovação.

Caminho possível: estudar notificações de mensagens do ZapChat e integração oficial de comunicação, separadas do painel de rádio. Qualquer interface veicular deve usar APIs e modelos permitidos; não contornar bloqueios ou projetar livremente esta interface.

Referências oficiais consultadas:
- https://developer.android.com/training/cars
- https://developer.android.com/training/cars/apps/library
- https://developers.google.com/cars/design/create-apps/app-types/communication
- https://developer.android.com/develop/connectivity/telecom/voip-app/api-updates
- https://developer.android.com/reference/android/media/AudioManager

Rotas Bluetooth no telefone são independentes de aprovação Android Auto. Reconhecimento do dispositivo pelo sistema não garante entrada de microfone, latência ou áudio utilizável em cada central.
