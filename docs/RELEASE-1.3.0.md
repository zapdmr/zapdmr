# ZapDMR 1.3.0 — arquitetura e entrega

## Rádio

O áudio continua autónomo no Android: serviço HBP UDP IPv4 e vocoder ARM, AudioRecord/AudioTrack, foco de áudio e ciclo de vida em primeiro plano. O Windows mantém o servidor local e o auxiliar WASAPI. As definições comuns são apresentadas por `radio-console.js`; `radio-bridge.js` adapta os controlos às duas plataformas.

- TG: desvinculação 4000 opcional, renovação HBP e ativação dinâmica; os pacotes de outra TG não entram no vocoder.
- Voz privada: destino Radio ID selecionado, bit individual HBP e FLCO USER_USER=3 no LC completo e embutido. O destino só transmite quando o operador aciona PTT. Não foi implementada sinalização telefónica de “a chamar/atendeu”. O master e o destinatário precisam encaminhar/aceitar chamadas individuais.
- TOT: ativação, 180s por padrão, aviso 10s; alterar o limite durante a fala preserva o tempo já transmitido.
- Scan HBP: um alvo de cada vez, pausa de 4s após atividade e tecla configurável. Não há um cliente Open DMR Terminal nem escuta simultânea de várias TGs nesta versão.
- SPP Android: RFCOMM, dispositivos emparelhados, reconexão, tokens de byte/linha, aprendizagem de premir/soltar/alternar/scan. Windows: porta COM de saída criada pelo emparelhamento SPP.
- Contadores medem bytes de payload HBP, incluindo login/keepalive, sem cabeçalhos IP/UDP. Android e Windows preservam os totais.
- Avisos Android, log limitado e exportável, escalas por área, cor suave/forte. Inglês traduz a nova consola; parte dos estados dinâmicos e telas existentes permanece em português.

## APRS

`AprsService`/`AprsPlugin` no Android; `aprs-client.ts` no Windows. TCP com IPv4, login verificado antes de enviar, mensagens de até 67 caracteres ASCII, ACK e três tentativas de entrega, histórico limitado. GPS e publicação da posição são opções explícitas. Desativar o envio de posição na interface encerra a sessão APRS existente imediatamente.

O intervalo fixo é 5min por padrão. A opção adaptativa reduz para 60s após deslocamento de 500m; não implementa todos os algoritmos de curva/velocidade do SmartBeaconing original. O mapa solicita apenas os mosaicos visíveis ao abrir, com atribuição OSM. A aplicação identifica-se no User-Agent.

## Comunidade, WhatsApp e portal

- WhatsApp obrigatório com validação E.164 no perfil de rádio e no cadastro de download.
- Telefone e sessão local protegidos, separados das definições exportadas e do master HBP.
- O portal Node/SQLite é separado do áudio: cadastro/download, confirmação de número, diretório autenticado e ZapChat próprio.
- A partilha do número é opcional e revogável. O diretório não revela cadastros não verificados.
- O botão verde junto ao indicativo e os marcadores do mapa abrem a procura de contacto. A conversa pessoal do WhatsApp é aberta no serviço oficial; o chat interno usa o protocolo ZapChat.
- A hospedagem, o DNS/HTTPS, os dados do responsável e o adaptador de entrega de códigos ainda precisam de configuração. Nada foi publicado remotamente e nenhum telefone/mensagem foi enviado durante a implementação.

## Verificação e limites

Compilação TypeScript e verificação sintática JavaScript. Compilação Android com Gradle no cache isolado do projeto, assinatura do APK e verificação dos recursos incluídos. Empacotamento Electron/Squirrel do Windows. A interface foi inspecionada em prévia local.

Não foram realizados nesta entrega testes físicos de microfone/altifalante, Bluetooth SPP, GPS, PTT bloqueado ou chamadas privadas no master. Não se confirmou entrega de WhatsApp/OTP por um provedor real. Os instaladores são uma edição beta para essa validação, não uma declaração de funcionamento em todo equipamento.

## Referências técnicas

- [MMDVM DMRDefines](https://github.com/g4klx/MMDVM-Host/blob/master/DMRDefines.h)
- [MMDVM embedded LC](https://github.com/g4klx/MMDVM-Host/blob/master/DMREmbeddedData.cpp)
- [HBP HBLink](https://github.com/HBLink-org/hblink3/blob/master/hblink.py)
- [APRS-IS](https://www.aprs-is.net/Connecting.aspx)
- [APRS 1.0.1](https://www.aprs.org/doc/APRS101.PDF)
- [WhatsApp Click to Chat](https://faq.whatsapp.com/5913398998672934/?locale=pt_BR)
