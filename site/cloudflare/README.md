# ZapDMR 1.3.1 em Cloudflare Workers Free + D1

O portal e a API da comunidade usam Workers + D1. Instaladores e fontes ficam em Releases do [repositório zapdmr/zapdmr](https://github.com/zapdmr/zapdmr). O servidor Node de ../server.mjs é uma alternativa; não é executado no Worker.

## Estado em 20/10/2026

O frontend e a API 1.3.1 com OTP foram publicados. A migração remota de confirmação e fila concluiu 14 comandos, além da inicialização histórica do banco. A ponte Windows Baileys está aberta em http://127.0.0.1:4193, com QR aguardando o responsável vincular **+5543996741200**. O recebimento real de um código e uma validação positiva em produção ainda não foram demonstrados.

O portal exige confirmação antes de gerar o link de instalador. Os builds Android e Windows 1.3.1 existem localmente. Atualize as URLs de download apenas depois de publicar e conferir os respectivos assets. A configuração ainda pode apontar à Release v1.3.0 durante a preparação da atualização; a versão do backend não determina qual APK/EXE está em uma URL.

Responsável: **Rizandro Cesar da Silva**. Contato/privacidade: **rizandro@gmail.com**. Consulte [o registro de 20/10/2026](../VERIFICACAO-2026-10-20.md), [autenticação](../AUTENTICACAO.md) e [OTP](../WHATSAPP-OTP.md). O [registro anterior](../VERIFICACAO-2026-10-19.md) preserva as verificações HTTPS e da Release realizadas em 19/10.

| Recurso | Implantação existente |
| --- | --- |
| Worker | zapdmr-community |
| Origem canônica | https://www.zapdmr.com.br |
| Origem alternativa | https://zapdmr-community.rizandro.workers.dev |
| Domínio raiz | zapdmr.com.br; redireciona GET/HEAD para www |
| D1 | zapdmr-community, binding DB |
| ID D1 | 6f272e21-de29-40a1-8bfd-801e00d2a95a |
| Zona | 22bdf6d6691d98a8e3e67892ebe21434, plano Free |
| DNS | dakota.ns.cloudflare.com e savanna.ns.cloudflare.com |
| Publicação | Wrangler 4.151.2 autorizado; OAuth cifrado com keyring Windows |
| Segredos | Chave de dados, segredo de download, senha admin e token privado da ponte |

Preserve registros MX, SPF e DMARC nas alterações de DNS. Não recrie a zona, banco ou chaves para uma atualização de assets.

## Fluxo de confirmação 1.3.1

- Site e app enviam cadastro com requestVerification=true e abrem confirmação de seis dígitos.
- Código criptográfico vinculado ao cadastro: dez minutos, reenvio após 60 segundos e até cinco tentativas.
- Sem confirmação, downloadUrl permanece nulo e não há nova sessão para ZapChat.
- Após verificar, a conta recebe whatsapp_verified=1, o código é consumido e a API retorna Bearer opaco de 30 dias e link de download de 15 minutos.
- O download confere assinatura, prazo e confirmação no banco. Fontes GPL e Releases públicas do GitHub continuam acessíveis fora do formulário.
- Confirmação de telefone não valida licença, indicativo ou DMR ID. A partilha de número é separada, opcional e revogável.

### Entrega direta

Configure WHATSAPP_API_URL e o secret WHATSAPP_API_TOKEN. O Worker faz POST HTTPS com Bearer e JSON {number,text}. A mensagem contém indicativo e código. O endpoint deve aceitar esse contrato e adaptar a API do provedor escolhido. Um template da API oficial Meta, por exemplo, pode exigir um adaptador.

O contrato legado OTP_DELIVERY_URL/OTP_DELIVERY_TOKEN recebe {phone,code,expiresInSeconds:600}. Nenhum token de provedor é público ou enviado ao app.

### Ponte local e confirmação reversa

A configuração atual usa WHATSAPP_LOCAL_BRIDGE=1 e WHATSAPP_CONFIRM_NUMBER=+5543996741200. O secret WHATSAPP_WEBHOOK_TOKEN, com pelo menos 32 caracteres, autentica a ponte.

A [ponte local](../whatsapp-bridge/README.md) usa Baileys 6.7.24, um cliente independente e sem vínculo oficial com a Meta. No primeiro vínculo, aguarda a ação no painel loopback 4193 e o responsável escaneia o QR em WhatsApp → Aparelhos conectados → Conectar aparelho. Uma sessão protegida já vinculada ao número correto pode ser retomada ao reiniciar. Sessão e token ficam cifrados por DPAPI CurrentUser. Não publique essa porta, não crie túnel e não coloque URL localhost em WHATSAPP_API_URL do Worker.

Depois de pareada com o número correto, a ponte faz heartbeat e consulta a fila HTTPS de saída a cada cinco segundos. O Worker só escolhe mode=bridge com conexão recente. Payload de destino/texto fica cifrado no D1. A consulta entrega até cinco trabalhos com lease temporária e leaseId. ACKs precisam repetir a identidade da tentativa; IDs enviados ficam cifrados na ponte para reduzir duplicação. Falhas ou perda de conexão podem levar o desafio ao modo reverso.

No modo reverso, o titular envia pelo próprio WhatsApp a mensagem pronta:
ZapDMR CONFIRMAR <token-aleatorio-de-43-caracteres> <codigo-de-6-digitos>.

A ponte recebe somente mensagens novas diretas nesse formato, extrai o remetente PN real e chama /v1/whatsapp/webhook com Bearer. O Worker compara telefone, nonce, código, prazo e tentativas antes de marcar reverse_confirmed_at. Site e app consultam /v1/auth/status para concluir a verificação. Abrir wa.me ou ver o código não comprova o número. Sem ponte receptora conectada, a mensagem reversa ainda não chega ao servidor.

O computador precisa ficar ligado e online. O QR disponível é uma etapa de vinculação, não prova de entrega. Não existe código mestre de produção. OTP_MODE=development é recusado pelo Worker; a homologação visível só existe no Node local com banco isolado e whatsapp_verified=false.

## Variáveis e segredos

| Configuração pública | Uso |
| --- | --- |
| PUBLIC_ORIGIN | https://www.zapdmr.com.br |
| OWNER_NAME | Rizandro Cesar da Silva |
| PRIVACY_EMAIL | rizandro@gmail.com |
| DOWNLOAD_ANDROID_URL / DOWNLOAD_WINDOWS_URL | URLs HTTPS dos assets realmente publicados |
| DOWNLOAD_ANDROID_BYTES / DOWNLOAD_WINDOWS_BYTES | Tamanho exato do instalador da mesma URL |
| DOWNLOAD_ANDROID_SHA256 / DOWNLOAD_WINDOWS_SHA256 | SHA-256 do mesmo instalador |
| SOURCE_URL | Fontes correspondentes, públicas |
| WHATSAPP_API_URL | Adaptador HTTPS, quando usado |
| OTP_DELIVERY_URL | Adaptador legado, quando usado |
| WHATSAPP_CONFIRM_NUMBER | Número receptor oficial |
| WHATSAPP_LOCAL_BRIDGE | 1 para fila local com heartbeat recente |

DATA_ENCRYPTION_KEY e DOWNLOAD_SECRET são secrets distintos, cada um com 64 caracteres hexadecimais. ADMIN_PASSWORD é uma senha privada forte. O helper configure-secrets.mjs reutiliza seu backup cifrado; não gere novas chaves em uma simples republicação. Perder ou trocar a chave de dados sem migração impede ler dados existentes.

WHATSAPP_API_TOKEN, OTP_DELIVERY_TOKEN e WHATSAPP_WEBHOOK_TOKEN são secrets, conforme os modos usados. configure-whatsapp-bridge.mjs prepara o token privado compartilhado e a configuração DPAPI da ponte. Nenhum valor secreto deve entrar no wrangler.jsonc, frontend, commit, argumento de comando ou relatório público.

Os backups DPAPI dependem do usuário Windows que os criou. Eles não são portáteis isoladamente. .env, .dev.vars, .wrangler, bancos, dados de usuários, sessões da ponte e chaves de assinatura devem permanecer fora dos pacotes públicos.

## Banco e atualização

A implantação existente já tem o banco e as migrações. Para atualizar código e assets, use esta pasta e a conta autorizada:

```powershell
npx wrangler whoami
npx wrangler deploy
```

Somente em implantação nova, crie o banco, preencha seu ID no binding DB e aplique schema.sql revisado. Em banco existente, faça backup e aplique apenas a migração incremental necessária. Reexecutar uma sequência ALTER TABLE já aplicada pode falhar; schema.sql não substitui um histórico de migrações.

A migração 1.3.1 adiciona estados de confirmação, modo e nonce, desafio cifrado, fila cifrada de WhatsApp e estado de conexão da ponte. A criação inicial do banco em 19/10 teve 17 comandos; a atualização OTP registrada em 20/10 teve 14. Esses números são resultados de execuções específicas, não instruções para repetir ambas as operações.

Wrangler deploy publica recursos remotos. A validação de certificado HTTPS deve permanecer ativa. A API privada não recebe cache público. A limpeza horária remove sessões/códigos expirados e registros pendentes antigos conforme o código.

## Releases e distribuição

Publique APK, EXE, ZIP das fontes correspondentes e SHA-256 em uma Release específica. Não use uma URL presumida antes de o asset existir. Depois atualize URL/tamanho/hash no Worker e republique. O instalador Windows e o ZIP de fontes são grandes demais para o limite individual de assets estáticos; use assets da Release, sem colocá-los no histórico Git.

Os arquivos locais 1.3.1 preparados nesta revisão são:

```text
release/ZapDMR-Android-1.3.1.apk
release/ZapDMR-Windows-1.3.1.exe
```

O repositório e a Release v1.3.0 já estavam públicos em 19/10. Isso não comprova por si só que uma nova Release 1.3.1 foi publicada. O mantenedor deve conferir a Release efetiva e as URLs atuais antes de anunciar a atualização.

## Cotas gratuitas

Limites abaixo foram consultados na documentação em **19/10/2026**; acompanhe o painel e a documentação atual antes de ampliar o uso.

| Recurso Free | Limite consultado |
| --- | --- |
| Invocações Worker | 100.000 por dia por conta |
| CPU Worker | 10 ms por invocação |
| Asset individual | 25 MiB |
| Assets estáticos por versão | 20.000 |
| D1 linhas lidas | 5 milhões por dia |
| D1 linhas gravadas | 100.000 por dia |
| D1 por banco | 500 MB |
| D1 armazenamento por conta | 5 GB, até 10 bancos |
| D1 Time Travel | 7 dias |

Assets servidos diretamente não consomem invocações do Worker; APIs e páginas geradas consomem. A ponte em polling de cinco segundos pode gerar cerca de 17.280 consultas por dia, além das demais chamadas e escritas de heartbeat. ZapChat também usa polling: uma consulta a cada 25 segundos equivale a cerca de 3.456 requisições diárias por usuário sempre conectado. A faixa gratuita não representa escala ilimitada.

As cotas D1 reiniciam às 00:00 UTC. Linhas lidas/gravadas e armazenamento devem ser monitorados. O domínio continua sujeito à renovação própria.

Referências: [Workers](https://developers.cloudflare.com/workers/platform/limits/), [Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [D1](https://developers.cloudflare.com/d1/platform/limits/), [preços D1](https://developers.cloudflare.com/d1/platform/pricing/), [Releases GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).

## Próxima observação necessária

O responsável precisa escanear o QR. Em seguida, observar uma entrega real, validar o código no site e no app e conferir o download e uma conversa entre instalações. Não há validação positiva de OTP em produção registrada nesta revisão. Os 38 checks isolados de 19/10 pertencem à implementação anterior e não validam a nova fila/ponte.

O Bearer da comunidade tem 30 dias e é separado do login HBP. ZapChat é próprio e cifrado no servidor, sem cifragem ponta a ponta; o botão Chamar no Zap abre o WhatsApp oficial. Polling de mensagens pode levar até 25 segundos, e recibos ao vivo exigem suporte do cliente ao canal receiptAfter/receipts.
