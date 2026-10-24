# Modo Carro — testes e roteiro real

## Evidência automatizada
Passaram: car-scan.test.cjs, car-ui.test.cjs, open-terminal.test.cjs, xlx-session.test.cjs, quick-exit.test.cjs, build:server e testCarPreviewUnitTest. Os testes de rádio usam masters UDP locais isolados; UI usa plugin simulado. CarModeStateTest passou 2 testes sem falhas. Compilação Android concluída. Revisão visual no navegador local, sem conexão de rádio.

| Cenário solicitado | Evidência atual | Validação física pendente |
|---|---|---|
| 1 Entrar/sair do modo | Harness UI, DOM normal preservado | Android real |
| 2 Scan lista configurada | Máquina de estados e ACK local | Master real |
| 3 Atividade real | Somente evento local, rejeita global/TG incorreta | Voz de segundo operador |
| 4 Retenção após RX | Relógio controlado, 4 s | Medir no aparelho |
| 5 Prioridade | Ordem intercalada, sem preempção | Chamada na prioritária |
| 6 Colisões de TG | Destino incorreto ignorado; uma inscrição | Dois operadores autorizados |
| 7 PTT durante scan | Exige parar/confirmar destino | Conferir TG recebida |
| 8 Soltar PTT | Stop e corrida de início tardio | Toque e acessório |
| 9 Bloqueio RX | Contrato/guard e UDP local | RX contínuo |
| 10 Pointercancel | Harness e lease nativo | Arrastar/cancelar/foco |
| 11 Bluetooth perdido | Evento simulado encerra; SPP existente reutilizado | Desligar acessório em TX |
| 12 Internet | Modelo congela e reinscreve | Modo avião/retorno |
| 13 DMR/XLX | Isolamento de protocolos e UDP XLX | Alternar perfis reais |
| 14 Reabertura | Preferências existentes reutilizadas; overlay temporário | Fechar/reabrir telefone |
| 15 Preservação | Dados originais separados por applicationId; UI não reescreve preferências normais | Atualização sobre candidata e conferência manual |

## Roteiro com telefone e carro estacionado
1. Guardar backup das configurações normais. Instalar o APK separado; não desinstalar nem limpar o ZapDMR normal. Configurar perfil de teste. Desconectar o app normal antes de usar o mesmo ID/master na candidata.
2. Abrir Definições → Perfil → Modo Carro. Verificar lista de favoritos e interface normal ao sair.
3. Escolher duas TGs autorizadas, permanência e retenção; fazer chamadas com outro operador. Confirmar que só RX local pausa o scan e que a retomada ocorre após a retenção.
4. Parar/confirmar TG, segurar PTT e falar; soltar. Conferir destino e terminador no receptor. Tentar TX durante RX e na proteção pós-câmbio.
5. Cancelar toque, alternar app e perder foco durante TX. Confirmar encerramento sem transmissão presa. Validar TOT em ambiente autorizado, sem ocupar TG pública desnecessariamente.
6. Testar SPP com DOWN/UP, desconectar em TX, reconectar; só então testar entrada automática autorizada.
7. Com veículo parado, conferir alto-falante e microfone separadamente em padrão, HFP/SCO, A2DP e LE Audio quando disponíveis. Anotar modelo do telefone, Android e central. Não confundir rota confirmada com áudio audível.
8. Interromper internet e restaurar; verificar reconexão e reinscrição. Alternar DMR/XLX apenas sem TX; conferir que scan fica indisponível no XLX.
9. Fechar/reabrir e conferir preferências. Atualizar somente o pacote de teste com mesma assinatura e comparar dados. Conferir que o aplicativo normal e os arquivos estáveis permaneceram intactos.

Não foi realizado teste em aparelho Android, Bluetooth físico, veículo ou rede de rádio real nesta etapa. ADB não apresentava dispositivo acessível. Nenhuma promessa de Android Auto ou homologação física.

Refinamento: repetidos os testes car-ui e car-scan. O harness também verifica mostrar/ocultar favoritos, abertura do seletor rápido e reconectar sem iniciar TX, invalidando o destino confirmado. Revisão visual local do seletor e painel circular. Teste físico continua pendente.
