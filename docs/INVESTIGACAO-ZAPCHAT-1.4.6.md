# Investigação inicial do ZapChat

Base: código e serviço publicados em 1.4.5, Worker Cloudflare + D1. Nenhuma mensagem foi enviada a operadores reais durante a investigação.

## Evidências anteriores às mudanças

- O teste existente `zapchat-attachments.test.mjs` passou com a API real e banco SQLite isolado: persistência, recuperação pelo destinatário, anexos, bloqueio e tentativas idempotentes. Isso demonstra que não se trata de uma rota de envio universalmente ausente.
- Consulta somente de agregados e esquema do D1 confirmou contas verificadas, sessões válidas e mensagens persistidas. Não foram consultados corpos de mensagens, telefones, códigos ou tokens.
- `web/community-chat.js`, funções `search`, `start`, `close` e listener `visibilitychange`: a consulta de mensagens pertence exclusivamente ao contato selecionado e só roda enquanto o diálogo está aberto e a página visível. Não há caixa de entrada, lista de conversas ou detecção global de mensagens. Um destinatário cadastrado que não procure manualmente o remetente não recebe aviso ou conversa na tela. Esta é uma causa concreta da percepção de falta de entrega, embora o servidor possa ter gravado a mensagem.
- `site/cloudflare/api.mjs`: sessões opacas expiram em 30 dias e não há renovação. `web/community.js:remote` apaga token e conta em qualquer HTTP 401, inclusive de fluxos que não significam revogação da sessão. Isso transforma expiração/erro em nova confirmação WhatsApp.
- A configuração mostra um endereço oficial como sugestão no formulário, mas `endpoint()` rejeita uma configuração salva vazia. A migração precisa estabelecer o endereço oficial sem substituir servidores explicitamente configurados.
- A tentativa de texto usa um identificador estável apenas na memória da conversa. Fechar/trocar a conversa apaga esse identificador; uma resposta de envio perdida seguida de nova tentativa após reabrir pode criar duplicata. Falta uma fila protegida de envios com o identificador preservado.
- Há confirmação de leitura, mas não uma confirmação distinta de recebimento no cliente. O rótulo atual corretamente diz enviada ao servidor; a nova entrega precisa de ACK real do destinatário.

## Plano de correção

Caixa de entrada/conversas, ACK de entrega, fila protegida e tentativas idempotentes; sessão de dispositivo com renovação e revogação sem remover a verificação inicial; diretório por indicativo e nome; notificações locais e integração push condicionada à configuração; manifesto/admin e instalação segura de atualizações. Preservar compatibilidade com sessões e instaladores antigos.

Os testes demonstrarão duas contas fictícias enviando e recuperando mensagens pelo backend real isolado. Testes que dependem de dois celulares reais, credenciais de infraestrutura ou instalação pelo sistema serão explicitamente separados.
