# Autenticação do ZapDMR

Leitura do código da versão 1.3.0 e do backend Workers + D1 em 19/10/2026. Os caminhos citados consideram a raiz do pacote de fontes (`site/`, `web/`, `src/`, `android/`). As linhas identificam esta revisão e podem mudar em versões futuras.

## Componentes e fronteiras

| Componente | Responsabilidade | Código |
| --- | --- | --- |
| Portal público | Cadastro para download; não cria uma sessão autenticada | [`site/public/site.js:70`](public/site.js#L70) |
| Cliente Windows/Android | Cadastro, pedido de código, token Bearer e conversa | [`web/community.js:12`](../web/community.js#L12), `remote():15`, `register():19` |
| Worker HTTP | Rotas, origens permitidas, CSP e cabeçalhos HTTPS | [`site/cloudflare/worker.mjs:18`](cloudflare/worker.mjs#L18), `route():42`, `protect():23` |
| API da comunidade | Verificação, sessões, autorização de acesso e downloads | [`site/cloudflare/api.mjs:105`](cloudflare/api.mjs#L105) |
| D1 | Cadastro, contas, hashes de sessões/códigos, mensagens cifradas e bloqueios | [`site/cloudflare/schema.sql:5`](cloudflare/schema.sql#L5) |
| Adaptador externo de códigos | Entregar o código ao telefone; credencial exclusiva do servidor | [`site/cloudflare/api.mjs:98`](cloudflare/api.mjs#L98), `deliverCode()` |
| Armazenamento nativo | Proteger telefone e token no dispositivo | [`src/server/secret-store.ts:6`](../src/server/secret-store.ts#L6), [`MobileAudioPlugin.java:176`](../android/app/src/main/java/br/radio/zapdmr/MobileAudioPlugin.java#L176) |

Existem credenciais diferentes para a comunidade, para o rádio HBP, para `/admin` e para publicar na Cloudflare/GitHub. A conta GitHub do mantenedor não é usada para autenticar os operadores na comunidade. O servidor Node de [`server.mjs`](server.mjs) é uma alternativa de hospedagem; a implantação Cloudflare executa `worker.mjs` e `api.mjs`.

## Fluxo de entrada na comunidade

```mermaid
sequenceDiagram
    participant App as ZapDMR
    participant API as Worker API
    participant DB as D1
    participant OTP as Adaptador de códigos
    App->>API: POST /v1/registrations (perfil e aceite)
    API->>DB: Cadastro com telefone cifrado
    API-->>App: registrationId, verified=false
    App->>API: POST /v1/auth/request-code
    API->>DB: Hash do código, validade e tentativas
    API->>OTP: HTTPS + Bearer privado (telefone e código)
    OTP-->>App: Código entregue ao titular pelo canal escolhido
    App->>API: POST /v1/auth/verify (registrationId e código)
    API->>DB: Validar e consumir código; criar conta e hash da sessão
    API-->>App: Token opaco e perfil; validade de 30 dias
    App->>API: Authorization: Bearer TOKEN
    API->>DB: Conferir hash, expiração e permissões
    API-->>App: Dados autorizados
```

1. **Cadastro:** `POST /v1/registrations` exige aceite explícito e valida indicativo, DMR ID e telefone internacional. Grava `phone_cipher` e `phone_hash`. O retorno contém um identificador de cadastro e `verified:false`; cadastrar ou baixar o app não confirma o telefone. A partilha do telefone é uma escolha separada. [`api.mjs:120`](cloudflare/api.mjs#L120).

2. **Pedido de código:** `POST /v1/auth/request-code` procura o cadastro e impede reutilizar um indicativo/DMR ID de conta existente com outro telefone ou outra identidade. O código tem seis dígitos, é gerado com aleatoriedade criptográfica e dura dez minutos. O D1 recebe somente HMAC de `registrationId:código`, validade e contador. Existem limites por IP e por telefone. [`api.mjs:18`](cloudflare/api.mjs#L18), [`api.mjs:127`](cloudflare/api.mjs#L127).

3. **Entrega:** `deliverCode()` envia telefone e código em JSON por HTTPS ao adaptador configurado, autenticando o servidor com `OTP_DELIVERY_TOKEN`. O código não é devolvido na resposta ao app. Se a entrega falhar, o código gravado é removido. Sem `OTP_DELIVERY_URL` e token, a API retorna 503 e não simula sucesso. [`api.mjs:98`](cloudflare/api.mjs#L98), [`api.mjs:132`](cloudflare/api.mjs#L132).

4. **Verificação:** `POST /v1/auth/verify` permite até cinco tentativas por código, confere HMAC e expiração e repete a verificação de conflito de identidade. Um lote D1 cria/atualiza a conta, grava a sessão e consome o código, com condições para impedir reutilização. [`api.mjs:139`](cloudflare/api.mjs#L139).

5. **Sessão:** o servidor gera 32 bytes aleatórios e devolve um token Base64URL de 43 caracteres. É um token opaco, **não um JWT**. O D1 guarda seu HMAC, o usuário e a expiração de 30 dias; o token original é entregue ao cliente na verificação. `currentUser()` exige `Authorization: Bearer ...` e consulta a sessão a cada chamada protegida. Não há cookie de sessão nem fluxo de refresh token. [`api.mjs:17`](cloudflare/api.mjs#L17), [`api.mjs:76`](cloudflare/api.mjs#L76), [`api.mjs:146`](cloudflare/api.mjs#L146).

Confirmar o código demonstra acesso ao número naquele momento. O código **não comprova licença, titularidade do indicativo, atribuição do DMR ID ou que o número está cadastrado no WhatsApp**. O backend atual valida o formato desses identificadores, sem fazer uma verificação independente de propriedade.

## Onde ficam as credenciais

| Valor | Persistência e uso |
| --- | --- |
| `DATA_ENCRYPTION_KEY` | Secret do Worker, 32 bytes em hexadecimal. O código usa essa chave para AES-256-GCM e também para HMAC-SHA-256 de telefone, códigos, sessões e identidades de limite de uso. Não vai para o app. |
| `DOWNLOAD_SECRET` | Secret diferente do anterior; assina os links temporários de download. |
| `ADMIN_PASSWORD` | Secret do Worker; exclusivo da administração. |
| `OTP_DELIVERY_TOKEN` | Secret do Worker; Bearer enviado apenas ao adaptador de códigos. Não configurado nesta etapa. |
| Telefone e mensagens | AES-GCM antes da persistência no D1, com IV aleatório de 12 bytes e tag de 128 bits. Indicativo, DMR ID, participantes e horários permanecem como metadados consultáveis. |
| Token da comunidade no app | Mantido em memória durante o uso e persistido pelo armazenamento nativo protegido; não é gravado em `localStorage` pelo módulo da comunidade. |

Referências: [`configuration():35`](cloudflare/api.mjs#L35), [`hash()/seal()/unseal():54`](cloudflare/api.mjs#L54), [`schema.sql:19`](cloudflare/schema.sql#L19).

No **Windows**, `localSave()` chama a API local `/api/community-profile`; ela usa `saveWindowsSecret()` para salvar `community-profile.dpapi`. O helper tenta DPAPI `CurrentUser` e, se isso falhar, usa `LocalMachine`. Esse fallback amplia a proteção para o escopo da máquina; as permissões do arquivo e a segurança do computador continuam relevantes. A API local aceita apenas conexões de loopback, sem exigir o Bearer da comunidade. [`community.js:12`](../web/community.js#L12), [`index.ts:905`](../src/server/index.ts#L905), [`secret-store.ts:6`](../src/server/secret-store.ts#L6).

No **Android**, o perfil passa por `saveRadioConfig()`, é cifrado com AES-GCM e salvo em preferências privadas. A chave é criada no `AndroidKeyStore`; o JavaScript recebe o perfil decifrado quando necessário ao funcionamento. [`MobileAudioPlugin.java:176`](../android/app/src/main/java/br/radio/zapdmr/MobileAudioPlugin.java#L176), [`getOrCreateKey():327`](../android/app/src/main/java/br/radio/zapdmr/MobileAudioPlugin.java#L327).

O token Bearer autoriza quem o possuir até expirar ou ser invalidado no servidor. Proteger arquivos não elimina o risco de um dispositivo comprometido ou de código malicioso executado no contexto do app.

## Autorização e encerramento da sessão

- `currentUser()` protege perfil, diretório, bloqueios e mensagens. O diretório aceita pesquisa exata; `publicUser()` só entrega telefone ao próprio titular ou quando ele autorizou a partilha. Bloqueios nas duas direções impedem descoberta e conversa. [`api.mjs:82`](cloudflare/api.mjs#L82), [`api.mjs:160`](cloudflare/api.mjs#L160).
- A consulta de mensagens restringe os resultados ao par formado pelo usuário autenticado e o contato. O remetente é obtido da sessão; não é aceito um remetente arbitrário do cliente. [`messageBatch():91`](cloudflare/api.mjs#L91), [`api.mjs:172`](cloudflare/api.mjs#L172).
- Ao receber 401, o cliente apaga token e conta locais. Trocar servidor, telefone ou identidade também limpa o vínculo local. [`community.js:15`](../web/community.js#L15), `beforeSave():18`, `saveAccount():22`.
- **“Sair da comunidade” apaga somente a sessão local.** Não há endpoint de logout/revogação individual implementado; uma cópia anterior do token continua válida no servidor até a expiração. [`community.js:34`](../web/community.js#L34).
- **Eliminar conta** usa `DELETE /v1/me`. As chaves estrangeiras do D1 removem sessões, mensagens e bloqueios associados. A limpeza agendada também elimina sessões/códigos expirados e cadastros sem conta confirmada após 30 dias. [`api.mjs:163`](cloudflare/api.mjs#L163), [`cleanup():220`](cloudflare/api.mjs#L220), [`schema.sql:29`](cloudflare/schema.sql#L29).

## Administração, downloads e publicação

**Administração:** `/admin` usa HTTP Basic, usuário `admin` e `ADMIN_PASSWORD`. Basic é codificação Base64, não cifragem; a proteção em trânsito depende de HTTPS. O Worker verifica as credenciais e limita tentativas. O retorno contém cadastros recentes sem telefone e a contagem de contas confirmadas. [`api.mjs:111`](cloudflare/api.mjs#L111).

**Downloads:** o cadastro pode gerar um link assinado com HMAC, válido por 15 minutos. O token contém somente ID do cadastro, plataforma e expiração. O Worker valida assinatura, validade e existência do cadastro, e redireciona a uma URL HTTPS permitida de GitHub Releases. Esse link não autentica o usuário na comunidade. As Releases públicas continuam acessíveis diretamente sem formulário; `/source` também é público. [`downloadToken():89`](cloudflare/api.mjs#L89), [`handleDownload():202`](cloudflare/api.mjs#L202).

**Publicação:** as credenciais do mantenedor ficam fora do frontend. `configure-secrets.mjs` gera as chaves, salva primeiro um backup DPAPI `CurrentUser`, reutiliza as chaves existentes e as passa ao Wrangler por entrada padrão; solicita armazenamento de autenticação no keyring. O backup desse helper não usa o fallback `LocalMachine` do app. Ele depende do perfil Windows e não é um backup portátil isoladamente. [`configure-secrets.mjs:30`](cloudflare/configure-secrets.mjs#L30), `prepareBackup():49`, `main():70`. `.dev.vars`, `.env`, `.wrangler`, dados, backups DPAPI e credenciais de assinatura não devem entrar no repositório ou em Releases.

## O que está separado do login da comunidade

O **rádio HBP/BrandMeister** usa Radio ID + ESSID e Hotspot Security Password. Envia `RPTL`, recebe o desafio do master, calcula SHA-256 do desafio concatenado com a senha, envia o resultado em `RPTK` e depois a configuração `RPTC`. Esse handshake não usa o telefone, o código OTP ou o Bearer da comunidade. [`brandmeister-gateway.ts:602`](../src/server/brandmeister-gateway.ts#L602), [`RadioSessionService.java:448`](../android/app/src/main/java/br/radio/zapdmr/RadioSessionService.java#L448).

**WhatsApp:** `community.js:39` abre `https://wa.me/numero` ou a aplicação oficial, quando o titular partilhou o telefone. Isso não incorpora conversas pessoais do WhatsApp, não autentica uma conta Meta no ZapDMR e não envia mensagens automaticamente. **ZapChat** é o serviço próprio do ZapDMR. As mensagens ficam cifradas no servidor, mas o servidor tem a chave para lê-las: não há cifragem ponta a ponta.

## Estado e limites desta revisão

- A entrega OTP ainda depende de um adaptador externo e de suas credenciais. Sem ele, novos usuários não conseguem confirmar o número e entrar no diretório/ZapChat. `/v1/status` informa `verificationConfigured`; mesmo `true` indica configuração, não prova entrega real. [`api.mjs:110`](cloudflare/api.mjs#L110).
- O Worker aplica origem permitida, CSP e limites de requisições. CORS não substitui autenticação: clientes fora do navegador também precisam do Bearer para acessar dados protegidos. [`worker.mjs:18`](cloudflare/worker.mjs#L18), [`api.mjs:67`](cloudflare/api.mjs#L67).
- Uma consulta pendente pode levar até 25 segundos para devolver mensagens novas. O app 1.3.0 ainda não consome o canal `receiptAfter`/`receipts`; confirmações de leitura podem exigir uma nova sincronização do histórico. [`api.mjs:177`](cloudflare/api.mjs#L177), [`community.js:27`](../web/community.js#L27).
- Não há recuperação automática de identidade/telefone, revogação individual de sessão, autenticação multifator do operador ou validação de licença implementadas neste fluxo. Alterar/perder a chave de cifragem sem migrar os dados pode impedir a leitura de telefones e mensagens existentes.

Este documento descreve o código inspecionado. Ele não substitui a validação de DNS/TLS, a entrega real de códigos ou uma conversa entre duas instalações reais. Para implantação e verificações registradas, consulte [`cloudflare/README.md`](cloudflare/README.md) e [`VERIFICACAO-2026-10-19.md`](VERIFICACAO-2026-10-19.md).
