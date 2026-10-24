# ZapDMR 1.4.9 — ZapChat, chamada privada e localização

## Android e Windows

O menu do indicativo na rodada oferece Conversar no Zap Chat, Chamada Privada
(Voz PTT Individual), Ver Localização, QRZ.com, Copiar indicativo e Cancelar.
O ZapChat abre a conversa interna, sem botão de WhatsApp externo. A verificação
inicial da conta por WhatsApp permanece no fluxo de cadastro existente.

Selecionar Chamada Privada prepara o Radio ID do colega, conserva o timeslot
selecionado e mostra o destino no badge. **Voltar para TG anterior** restaura
o grupo que permaneceu selecionado. Não transmite voz, não simula PTT nem envia
TG 4000. As restrições do servidor continuam valendo: o perfil XLX026 módulo C
continua restrito à chamada de grupo. O bloqueio durante RX é preservado.

## Alertas do ZapChat

- Contador no envelope e aviso que abre a conversa correspondente.
- Bip suave com deduplicação de mensagens e agrupamento sonoro de rajadas.
  Pode desativar em **Som de novas mensagens no ZapChat**.
- Windows: notificações nativas com a aplicação aberta/minimizada. O clique
  restaura a janela e abre a conversa, respeitando a conta atualmente conectada.
- Android: avisos locais quando o app recebe uma mensagem em segundo plano,
  com permissão de notificações. O som não solicita foco de áudio nem modifica
  a rota/volume do rádio; respeita silencioso e Não Perturbe.
- O envelope abre primeiro uma conversa com mensagens não lidas. A leitura
  atualiza o contador; mensagens antigas já avisadas não repetem o toque.
- Caixa de entrada a cada 5 s na frente e 20 s em segundo plano. No Android,
  o sistema pode adiar os pedidos em segundo plano por economia de energia.
- Com o aplicativo totalmente encerrado, notificações Android ainda dependem
  de configurar o Firebase/FCM já preparado. Não é declarado funcionamento com
  processo encerrado, nem no Windows sem o aplicativo em execução.
- A API adiciona `unreadAlerts` com metadados de mensagens ainda não lidas,
  inclusive as recebidas por outra instalação. Mantém `pendingMessages` e seus
  recibos compatíveis com os clientes anteriores; avisar não marca como lida.

## Localização

O mapa interno usa tiles OpenStreetMap com crédito visível, zoom e deslocamento.
Posições/rastro APRS são os pacotes públicos recebidos nesta sessão pelo APRS
existente, limitados à última hora e a 60 pontos por estação. Não solicita o GPS
do operador, não liga APRS nem publica posições automaticamente.

Sem APRS recente, consulta a cidade da base DMR ID e o catálogo offline GeoNames
(cities500, por país, CC BY 4.0). Marca explicitamente **centro aproximado da
cidade**, nunca como GPS atual. Não inventa coordenadas quando a cidade/estado
estão ausentes ou ambíguos. A posição depende da cobertura do catálogo.

Também oferece consulta externa no navegador ao aprs.fi para o indicativo,
com `timerange=3600&tail=3600`, conforme o exemplo PU5RZS fornecido. Não depende
de incorporar páginas de terceiros nem de extrair dados do aprs.fi.

Fonte de cidades: https://download.geonames.org/export/dump/readme.txt
Tiles: https://operations.osmfoundation.org/policies/tiles/

## Alcance da revisão

Interface revisada em prévia local isolada, sem conexão ao master, transmissão
ou mensagens para usuários reais. Menu, abertura interna do ZapChat e mapa da
cidade conferidos visualmente. Compilação dos instaladores não equivale a
confirmação de áudio, notificações e chamada privada em dois aparelhos reais.
