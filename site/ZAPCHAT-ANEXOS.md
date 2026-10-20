# ZapChat 1.4.0 — anexos e conversas

## Utilização

Na comunidade, procure um indicativo verificado, use o clipe e escolha Fotos e imagens ou Documentos e codeplugs. Confira a prévia, escreva uma legenda opcional e envie. Também é possível arrastar um arquivo para o chat ou colar uma imagem com Ctrl+V no Windows.

- Imagens: JPG, JPEG, PNG, WebP. Imagens maiores são reduzidas a 1280 pixels no lado maior, JPEG qualidade 80%, antes do upload. A miniatura abre uma imagem ampliável e permite baixar.
- Documentos: PDF, TXT e CSV em UTF-8, ZIP, RAR, DAT, RDT e BIN. O card mostra nome e tamanho e permite baixar sem executar o conteúdo.
- Um arquivo por mensagem, até **15 MiB (15.728.640 bytes)**; legenda de até 2.000 caracteres.
- Windows abre a caixa Salvar como. Android usa o seletor de destino do sistema, sem permissão geral de armazenamento.
- Histórico recente: 100 mensagens, com Carregar mensagens anteriores. Consulta de mensagens e confirmações de leitura com cursores fornecidos pelo servidor. Fechar, reabrir, trocar de contacto e voltar do segundo plano reiniciam a sincronização do contacto correto. Resultados atrasados e prévias do contacto anterior são descartados.

## Segurança e armazenamento da implantação Cloudflare

A migração aditiva `cloudflare/migrations/0002_zapchat_attachments.sql` cria metadados e blocos de arquivo no D1 existente. Não requer ativar R2 nem contratar hospedagem. Cada bloco de 512 KiB usa AES-GCM, IV aleatório e identidade do anexo/bloco autenticada. O nome também é cifrado. As chaves atuais são preservadas. Isso é cifragem no servidor, **não ponta a ponta**.

O arquivo só é disponibilizado depois de publicar sua mensagem. Downloads exigem sessão Bearer e participação na conversa; bloqueios impedem novos envios e downloads. Telefones e tokens nunca entram nas URLs dos anexos. Os arquivos não têm URL pública. Extensões e assinaturas de imagens/PDF/arquivos compactados são conferidas; codeplugs são tratados como dados binários, sem execução. O sistema não inclui antivírus nem certifica o conteúdo dos arquivos.

A reserva de espaço é atômica: 75 MiB enviados por operador e 250 MiB de anexos no projeto, conservando margem no banco D1 gratuito. Até três anexos não publicados por operador e 12 uploads/hora. O limite global pode ser alcançado com o crescimento da comunidade; nesse caso o envio informa falta de espaço. Não é armazenamento ilimitado. Uma evolução para armazenamento de objetos exige planejar capacidade e custo, sem ativação automática de plano pago.

Anexos publicados permanecem no histórico enquanto as contas existem. Excluir uma conta elimina suas mensagens e anexos associados, com limpeza dos blocos. Uploads abandonados são eliminados na limpeza horária depois de uma hora. Excluir uma prévia publicada não apaga a mensagem; o cancelamento apaga apenas o upload ainda não publicado.

## API

- `POST /v1/attachments?to=<id>&name=<nome>`: corpo binário, Content-Type e Bearer; responde `{attachment:{id,name,size,mime,kind}}`.
- `POST /v1/messages`: `{to,text,attachmentId?,clientId?}`. O mesmo clientId repete o resultado de um envio e evita duplicação em uma nova tentativa.
- `GET /v1/messages?peer=<id>&after=<cursor>&receiptAfter=<cursor>&wait=1`: mensagens, recibos, nextCursor e nextReceiptCursor. `before` pagina o histórico anterior. O cliente não usa o relógio local para avançar o cursor.
- `POST /v1/messages/read`: `{peer,through}` só marca como lidas mensagens até o último instante recebido.
- `GET /v1/attachments/<id>`: bytes privados; documentos usam Content-Disposition attachment.
- `DELETE /v1/attachments/<id>`: cancela upload próprio ainda não publicado.

Esta implementação de anexos pertence ao backend Cloudflare em produção. O servidor Node alternativo `site/server.mjs` mantém o protocolo anterior e não é uma alternativa de hospedagem de anexos nesta versão.

## Rádio 1.4.0

Por solicitação do responsável, selecionar uma TG, iniciar Scan ou reconectar não envia burst DMRD de ativação nem TG 4000. O filtro e o áudio RX local são trocados e limpos; a TG anterior não é reproduzida. O handshake HBP e keepalives necessários à sessão continuam. A BrandMeister pode exigir TG estática no master ou o primeiro PTT real para encaminhar uma TG dinâmica. O botão Desconectar TG 4000 é uma ação explícita separada.

Android usa AUDIOFOCUS_GAIN com foco atrasado, callback de retomada, pausa/flush durante interrupções e foreground service de reprodução. A receção e o vocoder continuam durante a espera, sem acumular áudio antigo. Falhas reais de saída têm aviso limitado, em vez de um erro por quadro. Chamadas e políticas do Android continuam sendo respeitadas.

## Verificação

Teste automatizado local: `node scripts/validation/zapchat-attachments.test.mjs`. Banco SQLite em memória, chaves e sessões descartáveis; nenhum usuário fictício é criado em produção. Cobre autenticação, privacidade entre três contas, limite de 15 MiB, integridade dos bytes, assinatura/extensão, repetição idempotente, cursores, recibos, bloqueio e eliminação em cascata.

Prévia local isolada: `node scripts/validation/chat-preview.mjs`, somente 127.0.0.1:4194. Duas abas simulam TEST1A e TEST1B; não são duas instalações reais de Android/Windows. Não há envio de WhatsApp nessa prévia. Receber, baixar e abrir anexos e recuperar o foco em aparelhos reais ainda exige conferir os novos instaladores no equipamento do operador.

A ponte WhatsApp continua neste computador Windows, que precisa permanecer ligado e online. A criação de hospedagem na Oracle foi abandonada a pedido do responsável.
