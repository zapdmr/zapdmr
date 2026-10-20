# Avisos opcionais de novas versões

O cadastro do portal apresenta uma opção independente, desmarcada por padrão: **Quero receber avisos de novas versões do ZapDMR pelo WhatsApp. Posso cancelar enviando PARAR.** Não autorizar não impede o código, o download nem o ZapChat. Contas já cadastradas não são inscritas retroativamente.

Após a verificação do telefone, o banco registra escolha explícita, data e versão do aviso. Aplicativos anteriores que não enviam esse campo preservam a escolha existente. O portal registra a solicitação do instalador; isso não prova que a pessoa concluiu a instalação.

A rotina horária do Worker consulta apenas publicações oficiais em `zapdmr/zapdmr`, confere os instaladores Android e Windows e exige que os downloads do portal apontem para a mesma versão. Enfileira lotes de até 30 operadores verificados, com autorização anterior à publicação e solicitação de uma versão anterior. A verificação pode levar até uma hora; públicos maiores avançam em lotes.

A ponte Windows envia no máximo um aviso a cada 30 segundos, dando prioridade aos códigos de acesso. O PC precisa ficar ligado, com internet e a sessão WhatsApp conectada. O número e a mensagem ficam cifrados no servidor; nada é listado publicamente. Há uma linha única por destinatário e versão, sete dias de validade e descarte posterior do conteúdo da fila.

A mensagem contém indicativo, versão e o endereço oficial de download. **PARAR**, **SAIR** ou **STOP**, recebidos diretamente do número titular, cancelam os avisos e a fila pendente sem afetar OTP ou ZapChat. O usuário pode fazer uma nova escolha explícita depois. Nenhuma confirmação de cancelamento é enviada automaticamente.

O início de cada envio é autorizado atomicamente e confere novamente a preferência. Um resultado incerto não é reenviado automaticamente para evitar mensagens duplicadas. A ausência de confirmação de entrega não prova que a mensagem foi recebida. Este cliente Baileys é independente da Meta e não oferece garantia absoluta de entrega.

## Administração e testes

`POST /admin/releases/notify` com Basic admin e `{version:"1.4.0"}` verifica a publicação e cria a mesma fila. Não aceita texto livre, listas de telefones nem números não cadastrados. Os endpoints `/v1/whatsapp/updates/pull`, `/start`, `/ack` e `/stop` exigem o token privado da ponte.

Teste local: `node scripts/validation/release-notifications.test.mjs`. Confere migração, preferência explícita, omissão por app antigo, elegibilidade, deduplicação, início único, recibos, cancelamento, preservação do OTP e descarte do conteúdo. Banco em memória e nenhum envio real. A migração de produção `0003_release_notifications.sql` foi aplicada separadamente dos anexos.
