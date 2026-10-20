# ZapDMR 1.4.1 — catálogo e Open DMR Terminal (beta)

## Catálogo concluído

65 TGs pré-configuradas em apenas dois grupos: **Nacionais** (34: Brasil 724, Português 915, regiões e estados) e **Mundiais** (31: seleção internacional do PDF fornecido). A TG 915 tem alcance global, mas fica em Nacionais conforme pedido do responsável. Outras TGs podem ser incluídas em **Cadastrar TG**. Cadastros personalizados anteriores, favoritos, indicadores de atividade e Scan foram preservados; categorias antigas são convertidas para os dois grupos.

## Diagnóstico do rádio anterior

- Windows: `src/server/brandmeister-gateway.ts` implementava Homebrew/MMDVM sobre UDP; Android: `RadioSessionService.connectAndReceive`. Autenticação RPTL → RPTK (SHA-256 do desafio + senha) → RPTC → RPTACK. A porta habitual era 62031.
- A seleção passava por `web/app.js` (`selectGroup`/`tuneSelectedTalkgroup`), `/api/link-talkgroup` no Windows e `ACTION_TUNE` no Android. Alterava somente o destino do filtro RX. Não havia inscrição no master.
- O PTT real emitia LC, quadros de voz AMBE e terminador DMRD. Isto podia estabelecer o encaminhamento dinâmico no master; marcar uma TG na interface não o fazia.
- O RX já era inicializado na conexão, independentemente do PTT. Os pacotes eram filtrados por destino e tipo de chamada, extraídos em palavras AMBE de 9 bytes, descodificados pelo vocoder e reproduzidos pelo auxiliar Windows ou AudioTrack Android.
- Last Heard e LEDs usam o monitor global BrandMeister e também eventos recebidos na sessão. Atividade global não comprova que áudio chegou ao operador. O novo estado RX usa exclusivamente a sessão de rádio.

## Implementação ODTP

`src/server/open-terminal.ts` e `android/.../OpenTerminal.java` implementam **Open DMR Terminal, serviço 0x21**, em transporte `REWIND01`. Não se usa a sessão Homebrew nem o serviço Simple External Application 0x20/porta 54005 como se fossem intercambiáveis. Referências de wire format: [implementação BrandMeister Rewind](https://github.com/BrandMeister/go-brandmeister/tree/master/rewind) e [cliente ODTP pyspot_rx](https://github.com/abo4/pyspot_rx).

ODTP usa Radio ID base, Hotspot Security Password e, habitualmente, UDP 54006. ESSID não é enviado. A senha permanece no armazenamento protegido existente, fora do GitHub e dos arquivos de distribuição.

O cliente envia keepalive com serviço 0x21, responde ao desafio de quatro bytes com SHA-256 e aguarda resposta autenticada. Depois cancela inscrições anteriores pelo comando ODTP 0x0902 e solicita o alvo com 0x0901. Trocas são serializadas e escolhas ultrapassadas são descartadas. Não há TG 4000, áudio silencioso ou PTT automático nessa transição.

ACK com destino identificado confirma a inscrição. ACK sem identificação mantém estado de espera; tráfego recebido com metadados do alvo comprova RX de rede. Nenhum destes sinais confirma que o utilizador ouviu som no altifalante. Ausência de confirmação ou rejeição produz erro visível, sem mostrar “recepção pronta”. Keepalives, reconexão e nova inscrição na conexão são tratados; não há fallback automático para Homebrew.

O transporte de voz ODTP mantém AMBE FEC de 9 bytes. Windows adapta os dados ao framer e ao auxiliar existentes; Android alimenta o vocoder existente. O PTT explícito continua enviando cabeçalho, voz e terminador. Destinos privados continuam separados do grupo, com inscrição privada para o Radio ID local e filtro pelo interlocutor escolhido. O cancelamento manual em ODTP usa o comando de cancelamento; em HBP, o botão manual TG 4000 continua explícito.

Perfis BrandMeister antigos sem protocolo definido e com portas convencionais são migrados para ODTP/54006; escolha explícita HBP e portas personalizadas são preservadas. Em **Definições → Servidor**, o operador pode escolher protocolo/porta. Mudanças valem após desligar e voltar a ligar. O master precisa oferecer ODTP; indisponibilidade não será disfarçada por transmissão silenciosa.

HBP continua disponível para servidores compatíveis. Como não oferece essa inscrição de terminal, sua interface informa a limitação e mantém seleção local sem transmitir.

## Arquivos principais

- `data/talkgroups-brasil.json`, `web/talkgroups-brasil.json`, `web/catalog-store.js`: catálogo e migração de categorias personalizadas.
- `web/index.html`, `web/app.js`, `web/styles.css`: filtros e formulário.
- `web/radio-protocol.js`, `web/operation-controls.js`, `web/radio-console.js`: perfil de protocolo e estados reais de RX.
- `src/server/open-terminal.ts`, `src/server/brandmeister-gateway.ts`, `src/server/index.ts`, `src/server/types.ts`: transporte, seleção, adaptação AMBE e configuração Windows.
- `android/app/src/main/java/br/radio/zapdmr/OpenTerminal.java`, `RadioSessionService.java`: transporte e integração nativa Android.

## Verificações

- `catalog-store.test.cjs`: 65 presets, listas exatas, JSON Windows/web/fallback iguais, aliases e cadastros antigos preservados.
- `catalog-selectors.cjs`: IDs únicos, seletores, dois grupos e ausência de PTT/4000 automático nas rotas de seleção.
- `talkgroup-activity.test.cjs`: janela de atividade, filtros, chamada em curso e retenção de 4 segundos. Corrigida expectativa antiga de 8 segundos do teste, sem mudar o algoritmo.
- `open-terminal.test.cjs`: **A–G em master UDP local isolado**: autenticação, cancelamento/inscrição, AMBE recebido antes do PTT, 91 → 72426, escolhas rápidas 7244/91/72426, áudio antigo rejeitado, nova conexão, PTT explícito, ACK ausente e senha recusada. Também verifica migração e mensagens da UI.
- `OpenTerminalTest.java`: mesmo núcleo de protocolo Android em JVM, sem Android/emulador: desafio, serviço correto, ACK com/sem destino, recepção, troca rápida, erro e encerramento.
- `zapchat-attachments.test.mjs` e `release-notifications.test.mjs`: regressão das funções de comunidade, somente em banco local. Nenhum WhatsApp enviado.
- Revisão visual local: filtros 34/65 e 31/65, TG atual preservada ao filtrar e troca de portas ODTP/HBP no formulário.

## Limites

Os cenários locais de protocolo não substituem ligação a um master BrandMeister real nem o teste de som, microfone e áudio em segundo plano em aparelhos físicos. Teste F real (PTT) só deve ser feito pelo operador. Não se afirma homologação ou funcionamento em todos os masters. O Scan continua percorrendo um alvo por vez; não foi convertido para escuta simultânea.

Anexos, OTP, ZapChat, avisos opcionais, banco da comunidade e ponte WhatsApp no PC são preservados. A hospedagem Oracle permanece fora do escopo, conforme pedido.

## Conexão real confirmada em 20/10/2026

O perfil local foi usado somente em memória para uma sessão ODTP no master `7242.master.brandmeister.network:54006`. Nenhuma configuração ou senha foi alterada. Autenticação aceita, cancelamento/inscrição respondidos.

| Alvo, na ordem do ensaio | Quadros de voz aceitos | Estado |
| --- | ---: | --- |
| TG 91 | 189 | receiving |
| TG 72426 | 98 | receiving |
| TG 7244 | 0 | awaiting-traffic |
| TG 91 | 196 | receiving |
| TG 72426 | 100 | receiving |

O ensaio bloqueou qualquer envio de cabeçalho/voz/terminador: total de tentativas de áudio de saída 0. TG 7244 ficou aguardando tráfego durante a janela observada; não se presume que a ausência de voz indique falha. Não houve PTT real. Estes resultados confirmam a entrega de AMBE pela rede, sem comprovar som no alto-falante, foco de áudio Android ou microfone.

Reconexão real adicional, somente RX: sessão 1 autenticada=true, estado=receiving, 97 quadros; sessão 2 autenticada=true, estado=receiving, 96 quadros. Nenhum PTT permitido no ensaio.
