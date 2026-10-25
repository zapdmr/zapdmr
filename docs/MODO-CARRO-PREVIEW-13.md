# Car Preview 13 — correção de controles e preservação da rota

Candidata de teste, sem publicação. Pacote br.radio.zapdmr.carpreview, código 15313, assinatura compatível com a prévia anterior. Não desinstalar nem limpar dados.

## Relato e conclusão limitada

O usuário confirmou que deseja um toque para iniciar/outro para encerrar e que o MyLink funcionou melhor na Preview 11. A captura comprova que a Preview 12 oferecia apenas a opção Segurar. Não há registo físico disponível para afirmar a causa completa da falha MyLink.

Riscos encontrados no código: modo manual forçado para hold, ignorando escolha salva; guardar ajustes reaplicava a rota de áudio mesmo quando o operador mudava apenas controles/tela; início do PTT do carro não solicitava permissão do microfone. Essas correções não comprovam por si só a resolução do comportamento no veículo.

## Correções

- Seletor oferece Segurar: premir/soltar e Tocar: um toque inicia/outro encerra. Por solicitação do usuário, Tocar é o padrão desta correção. A preferência forçada de prévias antigas é migrada uma vez para Tocar, sem modificar o modo normal. Uma escolha explícita Segurar feita e guardada na Preview 13 permanece respeitada nas próximas aberturas.
- PTT solicita permissão do microfone. Soltar durante a solicitação ou antes de concluir a ponte impede TX tardio. Cancelar, perder foco/sessão e TOT continuam encerrando o comando.
- Alternância continua com heartbeat da interface e limite nativo: perda da interface, RX e limites de transmissão não são contornados. Uso da tela estacionado ou por passageiro.
- Guardar PTT, brilho e inicialização não reaplica rota. Entrada/saída são aplicadas no Guardar somente após mudança explícita nos seletores. A ferramenta Testar microfone continua podendo aplicar a rota escolhida antes do teste local.
- Erros do rádio são exibidos no painel e liberam o comando pendente de PTT.
- Ganho TX 260%, faixa 0–300%, limitador e RX preservados. VOX continua indisponível. Novas opções da Preview 12 permanecem.

CarAudio.java e o motor Android de rádio/áudio são idênticos aos da Preview 12; CarAudio.java também é idêntico ao da Preview 11. Não foram trocados protocolo, autenticação, socket, roteamento HFP/SCO, vocoder ou credenciais. Não se atribui a falha física a uma alteração comprovada desses componentes.

## Verificação

- Harness UI Car 13 passou: segurar/soltar/cancelar, alternância em dois toques, soltar durante permissão sem TX tardio, RX, TS2 XLX, PTT de tela desligado, teste local, configurações e rodada preservadas, VOX bloqueado, autorização Bluetooth e automações. Ponte nativa simulada.
- Regressão de guardar ajustes passou sem chamada de reconfiguração de rota quando a entrada/saída não foram alteradas.
- Scan passou: inscrições sequenciais, pausas, 4 s após RX e isolamento XLX.
- Identidade e contratos de proteção passaram.
- Compilação Android e 27 testes JVM sem falhas.
- Captura da interface é simulação, sem rádio conectado.

Não realizados: PTT físico/tela em aparelho real, RX/TX DMR/XLX, ligação MyLink e recuperação após desconexão no veículo. Falha física ainda pendente de confirmação com teste/registo. Nada foi publicado ou instalado automaticamente.

## Teste no celular

1. Instale sobre a Car Preview anterior, sem apagar dados.
2. Estacionado, abra Ajustes → PTT manual da tela, escolha o comportamento e Guardar ajustes. Não mude entrada/saída já aprovadas. Se usar Tocar, confira que o painel mostra TOQUE PARA FALAR.
3. Confirme destino com o rádio conectado e RX livre. Teste dois toques ou segurar/soltar, conforme a escolha. Se pedir microfone, autorize e tente novamente; não deve transmitir sozinho após a autorização.
4. Repita no DMR e XLX026, confirmando áudio com outro operador. Preserve os 260% aprovados.
5. Caso falhe, exporte Definições → Registo → Todos os eventos logo após o teste e informe horário, rede/TG, versão anterior que funcionava melhor e se o PTT chegou a ficar vermelho.

Prontidão: candidata para teste. Não declarar o MyLink reparado sem validação real. As versões e instaladores anteriores permanecem preservados.
