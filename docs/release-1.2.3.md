# ZapDMR 1.2.3 — vinculação dinâmica

Seleção manual, dropdown e Scan solicitam vinculação silenciosa da TG. O cliente envia TG 4000, aguarda 3 segundos e envia Header LC, 18 codewords AMBE de silêncio e Terminator LC à TG escolhida. Não captura áudio do microfone para essa ação. Estas rajadas são uplinks reais, podendo aparecer no Last Heard.

Windows usa ESSID padrão 02. Android migra uma vez os valores comuns 01/02 para 03, preservando outros ESSIDs; a alteração fica no armazenamento cifrado. O diagnóstico usou 04 para preservar a sessão desktop existente. Não é possível afirmar que toda desconexão remota seja duplicidade; a mensagem orienta verificar ID/ESSID.

Validação real em master configurado, TG 91, 45 segundos após vinculação: 279 quadros DMRD recebidos, todos com destino 91, 777 codewords de voz extraídos. Primeiro operador observado: Radio ID 2354155. Sem captura de microfone. O teste não valida a saída física de som do Android, que requer aparelho.

O pipeline existente encaminha os codewords RX ao vocoder e ao renderizador e mantém medidores e resolução de operadores por base DMR ID. Localização continua sendo a cadastrada no banco, não localização GPS atual.
