# ZapDMR 1.3.1 — confirmação de WhatsApp

Atualização beta para Windows e Android. Estas notas registram a implementação e os builds locais em 20/10/2026; não representam confirmação de entrega real de OTP ou de operação em todos os dispositivos.

## Portal e aplicativo

- **Guardar e continuar** inicia o cadastro e apresenta uma etapa própria de confirmação, com código de seis dígitos, validade de dez minutos, até cinco tentativas, reenvio após 60 segundos e opção para corrigir o número.
- O cadastro e a confirmação usam a mesma API no portal e no aplicativo. A sincronização do perfil em segundo plano não solicita envio de código.
- O portal libera o link assinado do instalador após confirmar o número. A API também verifica o cadastro confirmado no endpoint de download. Os assets públicos do GitHub continuam acessíveis diretamente, e o código-fonte GPL permanece público.
- O envio pode usar adaptador HTTPS ou a fila da ponte WhatsApp local. Solicitação na fila é exibida como pendente; não significa mensagem entregue.
- A confirmação reversa abre uma mensagem pronta para o número oficial do ZapDMR. A aprovação exige que o receptor autenticado confira a mensagem recebida do número cadastrado. Exibir um código ou abrir o WhatsApp não confirma o telefone.
- A interface acompanha o estado a cada quatro segundos enquanto a etapa está visível. O contador de reenvio é independente dessa consulta, e falhas podem ampliar a espera.
- A sessão da comunidade é protegida pelo armazenamento nativo do dispositivo. A autenticação de rádio HBP permanece separada da confirmação do WhatsApp.

## Ponte local e disponibilidade

O número oficial configurado é **+55 43 99674-1200**. A ponte usa Baileys como aparelho vinculado, painel em loopback e credenciais cifradas com DPAPI CurrentUser. A fila do Worker/D1 usa payload cifrado, reserva por lease, confirmação da tentativa e fallback para recepção da mensagem de confirmação. O computador e a ponte precisam permanecer ligados e conectados para enviar e receber mensagens.

O pareamento foi reconhecido com a identidade oficial. Após uma correção e reinicialização controlada, a sessão foi retomada: o painel local confirmou `connected: true`, e `/v1/status` em produção informou `verificationMode: "bridge"`, `bridgeConnected: true` e `developmentMode: false`. **Ainda não foi registrada entrega real de código nem confirmação positiva de número em produção.** A conexão operacional da ponte isoladamente não comprova esse fluxo.

“Chamar no Zap” abre o WhatsApp do colega quando ele autorizou compartilhar o número. ZapChat é a conversa própria do ZapDMR, cifrada no servidor, sem cifragem ponta a ponta. Confirmar o telefone não comprova licença de radioamador ou titularidade do indicativo/DMR ID.

## Builds gerados localmente

| Arquivo | Tamanho observado |
| --- | --- |
| `ZapDMR-Android-1.3.1.apk` | 7.340.662 bytes |
| `ZapDMR-Windows-1.3.1.exe` | 160.699.904 bytes |

O arquivo `ZapDMR-Android-1.3.1-source.zip` também foi gerado. Confira os arquivos e hashes da Release efetivamente publicada antes de instalar. O pacote de fontes e o pacote do site podem ser regenerados para incluir a documentação final; seus tamanhos e hashes devem corresponder aos assets publicados.

O firmware autorizado acompanha os pacotes locais e pode preparar ou reparar o vocoder sem internet. Gerar o build não demonstra recepção ou transmissão de áudio em aparelho físico.

## Limites da revisão

- Não houve novo teste unitário ou smoke funcional do fluxo OTP, fila e ponte. Os 38 checks isolados de 19/10 pertencem à implementação anterior.
- Entrega/recepção real de OTP, liberação do download após confirmação, ativação do perfil e conversa entre duas instalações ainda precisam de observação positiva.
- O cliente 1.3.1 não consome o canal separado de recibos ao vivo; leituras são atualizadas ao sincronizar novamente o histórico. O polling de mensagens pode demorar até 25 segundos e depende das cotas de Workers/D1.
- Esta revisão não comprovou RX/TX físico, Bluetooth, GPS ou chamadas privadas em todos os aparelhos e masters.

Documentação: [confirmação WhatsApp](../site/WHATSAPP-OTP.md), [ponte local](../site/whatsapp-bridge/README.md), [autenticação](../site/AUTENTICACAO.md) e [registro de verificação de 20/10](../site/VERIFICACAO-2026-10-20.md).
