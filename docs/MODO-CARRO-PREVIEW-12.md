# Car Preview 12 — consolidação e estabilização

**Candidata para validação, não aprovada para lançamento. Sem publicação.**

Pacote Android `br.radio.zapdmr.carpreview`, versão `1.5.3-car-preview.12`, código 15312. Instalar por cima da Car Preview 11, sem desinstalar nem limpar dados. Aplicativo separado do ZapDMR estável. As versões 1.5.1, 1.5.2, candidata 1.5.3 e prévias anteriores não foram substituídas. Site, EXE, APK estável e manifestos públicos não foram alterados.

## O que mudou

- VOX retirado dos controles públicos do Modo Carro e dos ajustes avançados. Código, VAD e testes experimentais preservados. Bloqueios independentes na interface, ponte Android e serviço impedem que ajustes antigos habilitem VOX. Nenhuma captura contínua é iniciada pelo VOX nesta candidata.
- PTT retangular momentâneo mantido: segurar, soltar, cancelar e perda de foco encerram o comando. Bloqueio RX e proteção pós-fala continuam no motor existente. TOT do Modo Carro limitado a 180 segundos. Não foi oferecido PTT por alternância no carro nesta candidata; o modo normal mantém sua preferência.
- Ajustes organizados em Controles, Tela, Inicialização automática e Áudio. Scan fica em uma seção expansível. Opção PTT na tela não desativa PTT físico/SPP.
- Tela ligada somente enquanto o painel estiver visível. Brilho máximo opcional, desligado por padrão, aplicado à janela do app; brilho e estado anterior de tela ligada restaurados ao sair/pausar.
- Abertura opcional ao iniciar o aplicativo, ao conectar um dos Bluetooth autorizados e ao conectar carregador. Lista permite adicionar e remover dispositivos. Preferência antiga de um dispositivo é reaproveitada. Nenhuma dessas ações inicia transmissão, scan ou conexão de perfil novo.
- Nomes amigáveis no seletor de áudio; detalhes técnicos mantidos no diagnóstico. Teste local de microfone e roteamento Chevy MyLink preservados.
- Identificação no carro passa a aceitar o evento local do XLX que não traz o campo global. O serviço já normaliza TGs roteadas para TG 4003; não houve alteração no protocolo/áudio.
- Consulta usa o source ID recebido no pacote, nunca o ID do repetidor/gateway. Indicativo e nome vêm da base local ou dos metadados disponíveis. Sem correspondência: DMR ID numérico, sem inventar nome. Se o servidor substituir o source ID por um gateway, não há como descobrir o operador original sem metadados adicionais; a aplicação não tenta adivinhar.
- Localização da rodada remove componentes vazios, null e undefined, mantendo os dados disponíveis. Deduplicação por ID existente preservada.

## Preservação do áudio e sessão

Ganho TX de 0% a 300%, padrão inicial 260%, ajustes personalizados preservados. Testes JVM conferem 100%, 180%, 260%, 300% e limitação de picos. Volume e cadeia RX não foram modificados. CarAudio.java, CarTxGain.java, vocoder, protocolo de rádio, autenticação, perfis e arquivos dos atualizadores não foram modificados.

Sair do Modo Carro muda a interface e encerra o comando de PTT da tela, sem desconectar o rádio. A preferência de PTT normal, rodada e volume permanecem. Uma troca de servidor continua usando o fluxo existente de encerramento e autenticação.

## Resultados automatizados

| Verificação | Resultado e limite |
|---|---|
| Compilação Android e testes JVM | 27 testes, zero falhas; inclui ganho/limitador, estado de segurança, tipos de entrada e testes experimentais preservados |
| Interface Car 12 | Passou com ponte nativa simulada: PTT soltar/cancelar/blur, RX, XLX TS2, PTT da tela desligado, microfone local, ganho e rodada preservados, VOX bloqueado |
| Inicialização automática | Simulação passou: uma abertura por início, carregador sem reabrir em evento repetido, Bluetooth autorizado e rejeição de dispositivo não autorizado; nenhum TX |
| Identidade/localização | Passou: dados ausentes/parciais, null/undefined, indicativo/nome da base, fallback ID; verificações de contrato das proteções nativas |
| Scan | Passou: inscrição sequencial ODTP, confirmação do servidor, pausa em RX/TX, retenção de 4 s, reconexão e isolamento XLX |
| Cadastro | Harness de interface passou: mapeamento, criação aditiva/idempotente XLX, perfil e áudio preservados, sem PTT/conexão automática |
| Perfis Windows | API local e DPAPI passaram: segredos separados, persistência após reinício e BrandMeister preservado; não é teste de instalador ou rádio real |
| Atualizadores Android/Windows | Harnesses passaram: aviso, erros, adiamento durante TX, validação, dados preservados e entrega ao instalador; não instalaram uma versão real |
| Protocolos locais | ODTP e XLX em servidores UDP isolados passaram: autenticação, inscrição passiva, AMBE recebido, TS2/C, bloqueio RX + 500 ms, TX explícito/terminador e desconexão; não é áudio real em rede pública |
| Saída rápida | Simulação passou: RX/TX, cancelamento, limpeza, reabertura e perfil salvo |
| Layout | Simulação em 320×568, 320×640, 360×760, 412×892 e 740×360: PTT/scan/rodapé dentro da tela, sem overflow horizontal; VOX invisível |

O teste separado de áudio Windows não foi executado com sucesso: falta o executável auxiliar Windows no caminho esperado por esse teste neste checkout. Isso não é um resultado de falha do áudio Android. Nenhum EXE novo foi produzido.

## Auditoria de estabilidade

Revisão de código, não medição em aparelho:

- VOX indisponível elimina a captura contínua experimental; não foram alterados wakelocks de rádio, decoder ou reconexão aprovados.
- Painel mantém atualização visual existente; fora do carro não há renderização ativa do painel. Cache de identificação limitado a 256 IDs, com uma consulta em voo por ID.
- Abertura automática atua somente com ZapDMR em execução e interface visível. Se estiver oculto, aguarda retorno à tela. Não tenta iniciar uma Activity por trás do bloqueio do Android, não inicia app morto nem adiciona serviço permanente de vigilância Bluetooth/carregador.
- Brilho usa somente a janela do app, sem pedir alteração de configurações globais.
- Registro de dispositivos consulta Android localmente; não adiciona chamadas Cloudflare D1. Banco remoto e serviço do site não foram modificados. Revisão pontual confirmou recibos limitados a mensagens pendentes e rotação autenticada de sessão; não foi realizada medição dos limites/consumo da conta D1 em produção. Uma conclusão completa sobre quota exige métricas reais.
- Configurações são gravadas por Guardar ajustes, volume com atraso de 180 ms e fluxo de scan existente. Não foi criado polling que grave preferências repetidamente no banco remoto.

## Limitações e pendências reais

Não há aparelho USB conectado nesta entrega. Não foram realizados testes físicos de RX/TX, MyLink/SPP, brilho, bateria, memória, segundo plano, reconexão por perda real de internet ou instalação/atualização do Android. A aprovação anterior do MyLink e dos 260% é relato do usuário em prévias anteriores, não prova física da Car Preview 12.

Também faltam validação ponta a ponta do código de cadastro em homologação e atualização real por cima de versão antiga. Não houve acesso à produção para mudar políticas, gerar credenciais ou publicar manifestos. Bluetooth depende de permissões e eventos que o Android/acessório realmente fornece; A2DP não comprova disponibilidade de microfone do veículo.

O assistente de cadastro continua podendo aparecer se o cadastro estiver incompleto. Ele não é requisito de protocolo do servidor XLX e não deve ser confundido com senha de rádio.

## Roteiro de validação no celular

1. Instale por cima da Car Preview anterior, sem desinstalar. Confira Car Preview 12 nas informações do Android. Perfis e senhas devem permanecer; não limpe dados.
2. Teste primeiro o Modo Normal: rodada/contador, seletor, DMR RX/TX e XLX026 C/4003/TS2. Confirme indicativo/nome e ausência de null/undefined. Se a identificação não vier, anote o DMR ID exibido e o horário.
3. Abra Modo Carro pela barra. Confirme destino e teste segurar/soltar/cancelar PTT. Durante RX, confirme bloqueio. Faça testes reais de transmissão com o carro estacionado.
4. Em Ajustes, confira ganho 260% (ou seu valor salvo), saída e entrada MyLink. Teste microfone local, depois rádio com outro operador. Não altere o volume RX para compensar TX.
5. Desative PTT na tela, guarde e confirme que ficou bloqueado; teste botão SPP compatível separado, com pressionar/soltar. Reative se desejar.
6. Ative brilho máximo e tela ligada, guarde, saia do carro e envie o app ao segundo plano: brilho anterior deve voltar. Ao entrar novamente, só o painel visível aplica as opções.
7. Teste cada abertura automática separadamente: reiniciar app; conectar Bluetooth autorizado; conectar outro dispositivo; remover autorização; conectar carregador. Não deve haver TX automático nem reapertura contínua.
8. Scan: selecione TGs, acompanhe uma TG por vez, pausa durante RX, espera de 4 s e retomada. Teste ausência de internet e reconexão. No XLX, scan permanece indisponível.
9. Saia do Modo Carro e confirme a sessão e rodada mantidas no Modo Normal. Teste desligamento seguro.
10. Instalação nova e cadastro devem ser testados em emulador/perfil Android secundário com dados isolados, sem apagar sua instalação atual. Fluxo do site deve usar homologação e credenciais de teste autorizadas.
11. Se algo falhar, anote horário, rede/TG, entrada/saída e exporte Definições → Registo → Todos os eventos. Revise dados pessoais antes de compartilhar. Meça bateria/memória durante escuta prolongada para completar a auditoria.

## Prontidão

Pronta para **validação controlada como Car Preview**, não para lançamento oficial. Prioridades restantes: aprovação física RX/TX/identificação XLX, MyLink/SPP, automações/tela, instalação e atualização reais, cadastro em homologação e medição de consumo. A numeração oficial será definida depois da aprovação. Nada foi publicado.

Capturas em docs/images são simulação visual, sem rádio conectado.
