# Catálogo: atividade e scan

- **Todas / Ativas / Offline** combinam com a busca e a categoria selecionada. Ativas inclui tráfego observado nos últimos 60 segundos e sessões ainda em curso. Offline significa ausência de tráfego observado, não indisponibilidade da rede.
- **★** mostra favoritos. No Android, o catálogo base é incluído em JavaScript e renderizado antes da inicialização do rádio; favoritos e TGs personalizadas são restaurados do armazenamento local. A falha de uma API ou da rede não apaga os canais.
- Em telas pequenas, o catálogo abre ampliado. **Ligação e favoritos** mostra os controles de conexão. A lista tem sua própria área de rolagem; os LEDs ocupam uma coluna fixa de 12 px.
- **⛶** amplia o catálogo, ocultando temporariamente ligação e favoritos; **↙** restaura o painel.
- **Scan** procura atividade no catálogo filtrado, dá prioridade às sessões em curso e permanece na TG enquanto houver comunicação. Para atividade recente já terminada, aguarda 8 segundos antes de avançar.
- Iniciar o scan mantém a lista de canais visível, inclusive enquanto nenhum tráfego é observado.
- Escolher uma TG manualmente ou iniciar PTT interrompe o scan. O scan nunca envia voz, key-up ou comando TG 4000.
- A sintonia passiva só pode reproduzir áudio que o master encaminha à sessão HBP. TGs estáticas ou previamente vinculadas continuam sujeitas às regras do servidor; observar atividade global não abre automaticamente o áudio da TG.
- O cliente Last Heard Android é independente do relay Windows, usa TLS e reconecta com backoff. O estado do monitor aparece abaixo dos filtros.

Validação: testes de filtros, expiração e scan; testes JVM de envelopes JSON aninhados; conexão real do cliente Android ao Last Heard na JVM do computador; compilação TypeScript e APK. Recepção e transmissão em aparelho físico ainda precisam ser confirmadas pelo operador.
