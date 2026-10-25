# Car Preview 11 — candidata de teste

Não publicada. Android: br.radio.zapdmr.carpreview, código 15311, versão 1.5.3-car-preview.11. Instalar sobre a prévia anterior, sem desinstalar nem limpar dados. É um aplicativo separado do ZapDMR estável.

## Alterações

- O botão VOX OFF na tela principal ativa o VOX com sensibilidade, intervalo de silêncio e opções de áudio já salvos. Não é necessário abrir Ajustes novamente. VOX ON aparece somente após confirmação nativa da inicialização do microfone; ligar a escuta não transmite. Outro toque desliga.
- VOX permanece desligado ao iniciar e é suspenso quando a sessão, rota ou condições de segurança deixam de ser válidas. Trocas de perfil exigem nova confirmação do destino.
- PTT do Modo Carro retangular: segurar transmite, soltar/cancelar encerra; bloqueado durante RX e enquanto o VOX está armado. Preferências do PTT normal preservadas.
- XLX confirma TS2 para o destino do módulo C/TG 4003.
- Comparação do microfone entre monitor e TX agora usa a identidade física da entrada, em vez do identificador transitório do gravador. A verificação real da rota permanece obrigatória.
- Diagnóstico VOX SEM TRANSMITIR em Ajustes: acompanha voz, nível, ruído, calibração, entrada, silenciamento Android e foco. Bloqueia os caminhos de TX, inclusive PTT manual, durante o diagnóstico.
- Opções de supressão de ruído/eco mantêm o padrão ligado. São solicitações ao Android; o processamento próprio do fabricante/central pode continuar existindo.

Mantidos: roteamento MyLink aprovado pelo usuário, volume RX, ganho TX 0–300% (padrão novo 260%, ajustes existentes preservados), limitador, perfis, scan, ZapChat e interface normal. Nenhuma publicação ou alteração das versões anteriores.

## Diagnóstico e limitações

O usuário confirmou na prévia anterior microfone MyLink, RX e VOX DMR funcionando. Isso não valida fisicamente esta candidata. Sem o registo da falha, a causa do VOX XLX não está comprovada. Identificador transitório de captura, confirmação prematura de inicialização e TS incorreto eram riscos encontrados no código; não são um diagnóstico confirmado do veículo.

Não foi encontrado bloqueio de VOX por velocidade. Ruído, mudança de rota, captura silenciada pelo Android, chamada telefônica, RX ou perda da interface/heartbeat podem suspender o recurso. Nenhuma proteção foi removida. VAD detecta fala, não a identidade do operador; outras vozes podem ativá-lo. A qualificação inicial de aproximadamente 200–320 ms pode cortar o começo da primeira palavra. Proteções contra ruído, RX, eco e TOT de 180 s permanecem.

## Testes realizados

Automatizados: 27 testes JVM, sem falhas; interface com ponte nativa simulada (atalho, ajustes salvos, inicialização/cancelamento, RX, TS2, PTT soltar/cancelar, diagnóstico sem TX); entrada e scan; saída rápida; protocolos ODTP e XLX em servidores UDP locais; VAD nativo/JNI com voz de referência offline. Layout simulado conferido em 320×568, 320×640, 360×760, 412×892 e 740×360.

Não realizados nesta entrega: captura física Android/MyLink, áudio real DMR/XLX com VOX, ruído do Cruze, uso em movimento, teste real de TOT e eco. Nenhum celular estava disponível por USB. Não há aprovação real desta candidata.

## Roteiro de validação

1. Instale o APK sobre a Car Preview anterior. Não desinstale o aplicativo.
2. Com o carro estacionado, conecte o DMR, confirme TG/destino e aguarde RX livre. Toque VOX OFF, aguarde inicialização e calibração em silêncio. Fale uma frase e confirme com outro operador o áudio e o encerramento após silêncio. Desligue pelo mesmo botão.
3. Repita no XLX026, módulo C, TG 4003, TS2. Não há PTT de vinculação automático.
4. Em Ajustes, execute Diagnóstico VOX SEM TRANSMITIR. Teste fala e ruído de motor/ventilação com o veículo estacionado. O indicador VOX TESTE permite sair do diagnóstico.
5. Desligue o VOX e confira o PTT manual: segurar, soltar e cancelar.
6. Se houver falha, anote horário, rede/TG e entrada exibida. Em Definições → Registo, selecione Todos os eventos e Exportar, antes de fechar o app. O histórico é limitado a 500 eventos; exporte logo após reproduzir o problema.

O diagnóstico não salva gravação, GPS, senha ou endereço Bluetooth. Compartilhe o registo somente após revisar seu conteúdo. Não opere controles enquanto dirige; ajuste estacionado e peça a um passageiro para observar se necessário.

A aprovação de VOX XLX/MyLink permanece pendente do teste do usuário. A imagem incluída é simulação visual, não prova de conexão ou transmissão real.
