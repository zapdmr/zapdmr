# ZapDMR 1.3.1 — confirmação de WhatsApp

Atualização beta para Windows e Android, publicada na [Release v1.3.1](https://github.com/zapdmr/zapdmr/releases/tag/v1.3.1). Estas notas registram implementação, publicação e verificações de disponibilidade em 20/10/2026; não representam confirmação de entrega real de OTP ou de operação em todos os dispositivos.

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

## Distribuição publicada

O commit da etiqueta `v1.3.1` é `005287f84f5c9503b1081b7cc05db347baa924db`. A Release contém cinco assets enviados pelo projeto, além dos dois arquivos de fontes gerados automaticamente pelo GitHub. Os arquivos correspondentes completos do aplicativo e do site são os ZIPs identificados abaixo.

| Asset | Tamanho confirmado por HEAD HTTP 200 |
| --- | --- |
| `ZapDMR-Android-1.3.1.apk` | 7.340.662 bytes |
| `ZapDMR-Windows-1.3.1.exe` | 160.699.904 bytes |
| `ZapDMR-Android-1.3.1-source.zip` | 50.921.123 bytes |
| `ZapDMR-Site-Cloudflare-1.3.1.zip` | 219.395 bytes |
| Arquivo de hashes SHA-256 | 383 bytes |

Os hashes informados pelo GitHub correspondem aos arquivos preparados pelo projeto:

```text
178797625efb89c6ba7db77a160c239afe05c813ab6bc154c00b546fac957190  ZapDMR-Android-1.3.1.apk
e6fcf60f6e96b618c07a5ebdf2f2e34269b2cd4e363b2210985455b027f81a8a  ZapDMR-Windows-1.3.1.exe
8d1f63e770685bc7d5cb4938b42c8116ebebc631572f0b4d2c6dacc06335692e  ZapDMR-Android-1.3.1-source.zip
f46853ae009140533c0462f94e00381e8ac48fc384efd912d01f40e2c8404af1  ZapDMR-Site-Cloudflare-1.3.1.zip
```

O Worker foi republicado com as URLs e os hashes desta versão. O deploy Cloudflare final registrado é `5a792aa8-4193-41ec-8d8a-85ed89392c98`; `/v1/status` informou API 1.3.1, downloads atualizados e ponte conectada. `/healthz` respondeu HTTP 200 com `ok: true` e versão 1.3.1. Homepage, privacidade, termos e código-fonte também tiveram disponibilidade HTTP 200 confirmada. Estas notas podem receber atualizações posteriores ao empacotamento; os assets e hashes publicados acima foram preservados.

O firmware autorizado acompanha os pacotes locais e pode preparar ou reparar o vocoder sem internet. Gerar o build não demonstra recepção ou transmissão de áudio em aparelho físico.

## Limites da revisão

- Não houve novo teste unitário ou smoke funcional do fluxo OTP, fila e ponte. Os 38 checks isolados de 19/10 pertencem à implementação anterior.
- Entrega/recepção real de OTP, liberação do download após confirmação, ativação do perfil e conversa entre duas instalações ainda precisam de observação positiva.
- O cliente 1.3.1 não consome o canal separado de recibos ao vivo; leituras são atualizadas ao sincronizar novamente o histórico. O polling de mensagens pode demorar até 25 segundos e depende das cotas de Workers/D1.
- Esta revisão não comprovou RX/TX físico, Bluetooth, GPS ou chamadas privadas em todos os aparelhos e masters.

Para a validação real pendente, o formulário do portal foi preenchido na aba aberta. O titular ainda precisa ler e aceitar o aviso de privacidade, selecionar **Continuar** e digitar o código recebido no próprio WhatsApp. Esses atos não foram executados como se fossem uma confirmação automática do usuário.

Documentação: [confirmação WhatsApp](../site/WHATSAPP-OTP.md), [ponte local](../site/whatsapp-bridge/README.md), [autenticação](../site/AUTENTICACAO.md) e [registro de verificação de 20/10](../site/VERIFICACAO-2026-10-20.md).
