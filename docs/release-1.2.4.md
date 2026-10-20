# ZapDMR 1.2.4 — Android IPv4, localização e seleção passiva

- HBP Android: resolve somente Inet4Address, cria/binda socket em 0.0.0.0 e associa-o à rede ativa. Callback de rede fecha sockets antigos. ENETUNREACH/SocketException em envio provocam recuperação da sessão e novo handshake, sem reenviar voz gravada.
- Seleção de TG e Scan: alteram o destino/filtro local. Se faltar sessão, iniciam autenticação HBP com o perfil guardado. Não há Header/AMBE/Terminator automático ao selecionar, reconectar ou iniciar o app. O endpoint de vinculação automática fica desativado. TG 4000 continua disponível como ação explícita e é sinalização de rádio real.
- O HBP implementado não tem uma subscrição passiva equivalente à rajada dinâmica. Sem PTT/rajada, somente áudio já encaminhado pelo master (por exemplo TG estática) poderá ser ouvido. Não há ocultação de indicativo ou alteração de Source ID.
- Localização: rejeita rótulos genéricos e valores de slot; busca por ID e indicativo na base local e, para ausentes, consulta o endpoint público RadioID com timeout e cache. A localização é cadastral, não GPS em tempo real. Consulta verificada de 7246584/PU5RZS retornou Santo Antonio Da Platina, Parana, Brazil.
- Cache público de operadores no frontend limitado a 2.000 registros; Android também armazena respostas válidas em SQLite. Atualização da base completa permanece disponível.
- Layout móvel: ambos os medidores reservam espaço, sem encolhimento do bloco RX. Conferido em viewport 390x740 e 360x640; RX permaneceu dentro do card.

A compilação e assinatura não validam mudança física Wi-Fi/dados móveis nem som em um aparelho real. Nenhuma rajada de teste foi enviada nesta revisão.
