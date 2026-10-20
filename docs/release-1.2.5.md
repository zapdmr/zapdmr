# ZapDMR 1.2.5 — troca de TG e indicadores no PTT

- Seletor rápido PTT usa 🟢 para atividade recente nos últimos 60 segundos e 🔴 para ausência de atividade recente, com rótulos acessíveis. Atualiza as opções existentes sem reconstruir o menu a cada segundo.
- Windows e Android: seleção, dropdown, Scan e reconexão sincronizam a TG com o master sem captar voz para os comandos. O ciclo envia TG 4000, renova a sessão HBP, aguarda 1 segundo e envia Header LC + 18 codewords silenciosos + Terminator para o destino.
- Renovar a sessão é automático; não exige clicar em Desligar. A renovação foi necessária no teste porque a assinatura já mudava no master, mas o QSO anterior continuava chegando.
- A fila do alto-falante é limpa ao selecionar TG. Só pacotes destinados à TG selecionada são enviados para reprodução. Durante a troca, o RX fica suspenso e o PTT bloqueado, preservando o codec e a sessão de áudio.
- Seleções rápidas são ordenadas; pedidos substituídos não voltam a ativar o destino antigo.
- A sinalização é uma transmissão real e pode aparecer no Last Heard com o indicativo do operador. Não há ocultação de Source ID.

Validação real, ESSID de diagnóstico 04, sem microfone: TG 91 recebeu 165 quadros / 486 codewords; após unlink + renovação HBP + link, TG 724 recebeu 28 quadros / 60 codewords. Os contadores incluem a fase de transição, na qual 7 quadros antigos da TG 91 também chegaram; a nova filtragem impede sua reprodução. A saída física de áudio Android e a troca Wi-Fi/dados móveis continuam dependentes de teste em aparelho.
