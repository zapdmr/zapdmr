# Car Preview 04 — correção de acesso no Android

## Diagnóstico e limite da evidência
Os APKs anteriores conferidos contêm index.html, car-mode.js, car-scan.js e car-mode.css. A entrada anterior ficava em Definições → Perfil. A captura enviada não mostra essa entrada. Sem consultar o pacote instalado e os erros da WebView no aparelho, não é possível determinar se foi aberto o aplicativo normal, um APK anterior ou se ocorreu falha na inicialização. Não foi comprovada uma causa única no celular. Não há condição Android Auto/CarLink na implementação.

Foram corrigidos pontos concretos: entrada estática visível na tela PTT, tratamento explícito de ausência/falha do painel, resolução da ponte nativa por Plugins ou registro, operações de janela na thread principal, identificação inequívoca do pacote de teste e preservação do player existente ao entrar/sair com rota padrão. A falha não será tratada como resolvida no aparelho até o usuário conseguir abrir e sair do painel.

## Identificação
Aplicativo: **ZapDMR Car Preview 04**. Pacote: br.radio.zapdmr.carpreview. Versão: 1.5.3-car-preview.4, código 15304. APK de teste separado, sem publicação ou alteração dos instaladores 1.5.1/1.5.2/candidata 1.5.3. Pode atualizar a prévia anterior com mesma assinatura, preservando dados dela; não substitui o ZapDMR normal.

## Uso
1. Instalar o APK 04. Abrir o ícone **ZapDMR Car Preview 04**.
2. Se necessário, ativar o cadastro ou configurar o perfil na prévia; não apagar o app normal.
3. Na aba PTT, conferir a etiqueta **Car Preview 04 · teste no celular** e tocar **ATIVAR MODO CARRO**.
4. Conferir a interface simplificada. Em Ajustes, escolher manter tela ligada e a lista de scan. Entrada automática por Bluetooth permanece opt-in e exige aplicativo vivo/dispositivo autorizado.
5. A saída padrão preserva a rota que já funciona no Cruze. Saída e microfone são indicados separadamente quando efetivamente observados pelo Android. Dispositivo disponível não comprova microfone ativo.
6. Testar saída com tom local. Testar microfone exige confirmação e permissão do Android; grava e reproduz localmente, sem transmitir. Fazer testes sem RX/TX em andamento e veículo estacionado.
7. PTT exige destino confirmado, obedece bloqueio RX e limite TOT do perfil (proteção permanece habilitada neste modo). Soltar/cancelar/perder foco encerra. O painel não muda a preferência PTT normal.
8. **SAIR DO MODO CARRO** restaura a interface normal. A preferência de tela é aplicada só enquanto a Activity estiver visível e o modo ativo; ao sair restaura o comportamento anterior. Não usa wake lock novo.

## Testes
Automatizados: car-entry04 (entrada e diagnóstico de falhas), car-ui (estado/preservação/PTT/reconectar), car-scan (inscrições/ACK/RX local/retensão), testes JVM e compilação Android. Testes de contratos de código complementam o harness; não comprovam execução física do Android.

Roteiro obrigatório em aparelho: abrir normal; ativar; confirmar mudança imediata; ouvir RX sem perda; apertar/segurar/soltar PTT; cancelar e alternar app; RX DMR; TX XLX; trocar perfis sem TX; verificar opção de tela ligada e segundo plano; sair; fechar/reabrir e conferir preferências; retirar/restaurar internet; medir bateria/temperatura por sessão de 30–60 minutos. Áudio real e Bluetooth no Cruze devem ser testados estacionado, com outro operador autorizado.

O usuário confirmou que a saída de áudio do aplicativo funciona no Cruze, mas não confirmou o painel 04, o microfone da central ou RX/TX nesta candidata. ADB ainda não apresentou dispositivo autorizado nesta etapa. Não declarar validação física ou correção definitiva antes desse retorno.
