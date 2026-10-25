# VOX reservado para desenvolvimento

A Car Preview 12 não oferece VOX. A UI e o BuildConfig.EXPERIMENTAL_CAR_VOX estão desligados; configurações antigas não habilitam os monitores.

Preservados: CarVoxGate, CarVoxEffects, WebRtcVad/C/JNI, monitor e integração de TX, testes CarVoxGateTest/CarVoxProtocolsTest e fixtures offline. O histórico/fonte da Preview 11 contém a interface de diagnóstico e os testes daquela prévia. Os controles correspondentes permanecem inacessíveis (hidden/inert) e bloqueados nesta candidata, sem caminho de ativação pública.

Retomar somente em ramo experimental, com testes de falso acionamento, RX/eco, Bluetooth e autorização explícita. Não habilitar o flag na candidata de estabilização.
