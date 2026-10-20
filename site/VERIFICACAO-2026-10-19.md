# Verificação do portal — 19/10/2026

## Dados confirmados pelo responsável

- Responsável: Rizandro Cesar da Silva.
- Contato público e privacidade: rizandro@gmail.com.
- Domínio registrado: zapdmr.com.br.
- Preferência: hospedagem gratuita; possui conta Cloudflare.

## Concluído localmente

- Revisão do formulário: método POST, JavaScript necessário, telefone fora da URL, tratamento de falhas de rede/HTML e URL de instalador restrita à própria origem.
- Navegação entre homepage, downloads, privacidade e termos corrigida; páginas legais geradas no servidor com H1 e canonical próprios.
- Disponibilidade de confirmação de número e ZapChat mostrada a partir do estado real da API.
- Servidor Node preservado como alternativa; backend adaptado para Workers + D1 sem servidor Node contínuo.
- Telefone e mensagem cifrados antes da gravação; API exige configuração privada válida.
- Índices, paginação de mensagens, canal separado de recibos e proteção distribuída contra excesso de requisições no D1.
- Instalação local do Wrangler 4.151.2; compilação final com `wrangler deploy --dry-run` concluída. O comando não publica.
- Esquema D1 aplicado no emulador local: 17 comandos concluídos. A aplicação remota também foi concluída posteriormente, conforme abaixo.
- Prévia Workers: homepage, privacidade, termos e `/healthz` retornaram HTTP 200; nome e e-mail conferidos no HTML e no navegador.
- API sem segredos retornou 503; origem externa não autorizada recebeu 403, sem cabeçalho de liberação CORS, com CSP. URL inexistente retornou 404.
- Nenhum código de confirmação, WhatsApp ou mensagem foi enviado a uma pessoa real.
- Smoke funcional isolado Miniflare/workerd + D1: **38 verificações passaram**. Incluiu formatos, cadastro fictício, telefone cifrado, compatibilidade de cifragem Worker/Node, Bearer, partilha opcional, mensagens UTF-8, recibos, paginação de 126 mensagens e 126 leituras, 20 envios concorrentes, bloqueios, administração, link assinado, tentativa de adulteração e eliminação em cascata. A rede externa estava desativada. O long polling devolveu mensagem nova após 25,17 segundos; entrega OTP não foi simulada como sucesso.

## Publicação remota confirmada

- OAuth do Wrangler 4.151.2 autorizado na conta Cloudflare; credencial persistente cifrada e protegida pelo keyring do Windows.
- D1 remoto `zapdmr-community` criado, binding `DB`, ID `6f272e21-de29-40a1-8bfd-801e00d2a95a`. Esquema aplicado com 17 comandos concluídos.
- Três segredos de produção gerados e cadastrados: `DATA_ENCRYPTION_KEY` e `DOWNLOAD_SECRET` diferentes, com 64 caracteres hexadecimais cada, e senha administrativa aleatória forte. Backup cifrado DPAPI CurrentUser em `outputs/work/zapdmr-cloudflare-secrets.dpapi`, dependente do usuário Windows que o criou e excluído de todos os pacotes públicos. Não foram registrados valores dos segredos neste relatório.
- Worker `zapdmr-community` publicado em `https://zapdmr-community.rizandro.workers.dev`, com domínios personalizados `www.zapdmr.com.br` e `zapdmr.com.br`. Versão publicada após ativar as URLs: `56d38b61-486a-4371-a028-4c7981198b47`.
- Zona Cloudflare `22bdf6d6691d98a8e3e67892ebe21434` ativa no plano Free. Servidores DNS: `dakota.ns.cloudflare.com` e `savanna.ns.cloudflare.com`, configurados pelo responsável. Registros existentes de e-mail, incluindo MX, SPF e DMARC, devem continuar preservados nas alterações de DNS.
- Homepage de [www.zapdmr.com.br](https://www.zapdmr.com.br) aberta por HTTPS no navegador. O domínio sem `www` redireciona com HTTP 308 para o endereço canônico em GET/HEAD.
- No navegador, `/healthz` respondeu `{ok: true, version: "1.3.0"}` e `/v1/status` informou cadastro ativo, `verificationConfigured: false` e responsável/e-mail corretos. A página de privacidade exibiu o H1, o nome, o e-mail e o conteúdo legal esperados.
- Uma nova consulta HTTPS por `Invoke-WebRequest`, fora do sandbox restrito, confirmou HTTP 200 em `/v1/status`, JSON correspondente ao observado no navegador e HSTS com `max-age=31536000`. As falhas TLS anteriores ficaram limitadas ao ambiente restrito; não foi necessário ignorar a validação de certificado.
- Repositório público [zapdmr/zapdmr](https://github.com/zapdmr/zapdmr) criado. [Pré-release v1.3.0](https://github.com/zapdmr/zapdmr/releases/tag/v1.3.0) publicada com quatro assets: APK, EXE, fontes e SHA-256. O commit/etiqueta `65d900b4e0e02a65dea17fcc18b41bf54497ca76` contém 128 arquivos de código e documentação revisados para publicação, incluindo a explicação de autenticação.
- `DOWNLOAD_ANDROID_URL`, `DOWNLOAD_WINDOWS_URL` e `SOURCE_URL` preenchidas com os assets reais em `wrangler.jsonc`; tamanho e SHA-256 dos instaladores também configurados. Nova publicação do Worker concluída para ativar essa configuração.
- Verificação final por HTTPS direto: GET `/`, `/healthz`, `/v1/status`, `/privacidade/` e `/termos/` retornou HTTP 200. `/v1/status` confirmou cadastro ativo, `verificationConfigured: false` e downloads disponíveis nas duas plataformas com os hashes correspondentes.
- HEAD dos assets públicos no GitHub retornou HTTP 200: APK com 7.336.566 bytes, EXE com 160.696.832 bytes e fontes com 50.899.596 bytes.
- Conferência de acesso: domínio raiz respondeu 308 para `https://www.zapdmr.com.br/`; `/source` respondeu 302 para o ZIP público de fontes; `/v1/me` sem Bearer respondeu 401.

## Ativação da comunidade e limites de verificação

- A publicação da Release, ativação das URLs no Worker e disponibilidade dos assets estão confirmadas. O envio remoto do formulário e o redirecionamento assinado do portal ainda não foram validados como fluxo completo. Downloads em GitHub Releases são públicos também fora do formulário.
- A revisão automática bloqueou a tentativa de cadastro sintético em produção porque o procedimento proposto apenas preparava a remoção e poderia deixar o registro persistente. O comando não foi executado; nenhum cadastro de teste foi inserido em produção. A validação do POST e do link assinado permanece nos 38 testes isolados.
- **Único bloqueio funcional restante para novas contas da comunidade:** o provedor/adaptador de entrega de códigos ainda não foi configurado. Sem ele, novos números não são confirmados e novos perfis não entram no diretório/ZapChat. Não foi usada confirmação simulada.
- O Worker pode demorar até 25 segundos para responder a uma nova mensagem durante uma consulta pendente. O plano gratuito tem cotas e não representa escala ilimitada.
- App 1.3.0 mantém o contrato básico de mensagens; recibos ao vivo exigem cliente que envie `receiptAfter` e aplique `receipts`. O cliente atual só atualiza leituras ao sincronizar novamente o histórico.
- Homepage, saúde, estado da API e privacidade públicos foram conferidos no navegador; não foi feito teste remoto completo de cadastro, entrega OTP ou conversa entre duas instalações reais do app. Nenhum código de confirmação ou mensagem foi enviado a uma pessoa real.

Consulte [AUTENTICACAO.md](AUTENTICACAO.md) para os componentes, o fluxo das requisições e a proteção de credenciais/tokens.

## Pacote de publicação

`release/ZapDMR-Site-Cloudflare-1.3.0.zip` é o pacote do site, com fonte, assets, esquema, configuração e instruções, acompanhado de `SHA256SUMS-Site-Cloudflare-1.3.0.txt`. A lista explícita de inclusão exclui bases de dados, segredos, `.wrangler`, `.dev.vars`, `node_modules`, arquivos DPAPI e outros arquivos privados. Os instaladores Android/Windows da versão 1.3.0 permanecem nos arquivos de distribuição existentes e estão publicados separadamente na Release.
