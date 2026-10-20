# ZapDMR em Cloudflare Workers Free + D1

Este pacote prepara o portal `www.zapdmr.com.br` e a API da comunidade para Cloudflare Workers, usando D1 como banco. Os instaladores ficam em GitHub Releases. O servidor Node de `../server.mjs` continua sendo uma alternativa de hospedagem; ele não é o processo executado no Worker.

**Estado em 19/10/2026:** o Worker está publicado em [www.zapdmr.com.br](https://www.zapdmr.com.br), com homepage HTTPS conferida no navegador. O banco D1 remoto e os três segredos de produção estão configurados. O domínio sem `www` redireciona com HTTP 308 para o endereço canônico em requisições GET/HEAD. A pré-release `v1.3.0` está em rascunho no GitHub com quatro assets enviados; falta publicá-la e preencher as URLs no Worker. A confirmação do número continua desativada por falta do provedor de códigos. O responsável é Rizandro Cesar da Silva, com contacto de privacidade em rizandro@gmail.com.

Também foram conferidos no navegador `/healthz` (`ok: true`, versão `1.3.0`), `/v1/status` (cadastro ativo, confirmação e downloads ainda indisponíveis) e a página de privacidade com os dados corretos. Uma consulta HTTPS direta fora do sandbox restrito confirmou HTTP 200 em `/v1/status`, o mesmo JSON e HSTS com `max-age=31536000`. As falhas TLS anteriores ocorreram no ambiente restrito; a validação de certificado permaneceu ativa.

### Implantação existente

| Item | Estado confirmado |
| --- | --- |
| Worker | `zapdmr-community` |
| Endereço alternativo | `https://zapdmr-community.rizandro.workers.dev` |
| Domínios personalizados | `www.zapdmr.com.br` e `zapdmr.com.br` |
| Versão publicada | `6925b2f9-aca2-4f20-97f6-71e86da604f3` |
| D1 | `zapdmr-community`, binding `DB`, ID `6f272e21-de29-40a1-8bfd-801e00d2a95a` |
| Esquema remoto | 17 comandos aplicados |
| Zona DNS | `22bdf6d6691d98a8e3e67892ebe21434`, ativa no plano Free |
| Servidores DNS | `dakota.ns.cloudflare.com` e `savanna.ns.cloudflare.com` |
| Credencial de publicação | OAuth autorizado no Wrangler 4.151.2, protegido por cifragem e pelo keyring do Windows |
| Segredos | `DATA_ENCRYPTION_KEY`, `DOWNLOAD_SECRET` e `ADMIN_PASSWORD` cadastrados |

Os registros de e-mail existentes, incluindo MX, SPF e DMARC, devem ser preservados em alterações de DNS. O backup dos segredos está protegido com DPAPI CurrentUser em `outputs/work/zapdmr-cloudflare-secrets.dpapi`; ele depende do usuário Windows que o criou e **nunca deve entrar em pacotes ou repositórios públicos**. Consulte [AUTENTICACAO.md](../AUTENTICACAO.md) para o fluxo de autenticação e tratamento de tokens.

## 1. O que pode ficar gratuito

| Componente | Serviço | Observação |
| --- | --- | --- |
| HTML, CSS, JavaScript e logótipo | Workers Static Assets | Arquivos pequenos do portal |
| Cadastro, autenticação, diretório e ZapChat | Worker Free + D1 Free | Sujeitos às cotas abaixo |
| APK, instalador Windows e código-fonte | GitHub Releases em repositório público | Downloads públicos, inclusive fora do portal |
| Abrir a conversa do colega no WhatsApp | Link oficial `wa.me` | O operador envia pela aplicação oficial |
| Confirmar o telefone por código | Provedor externo de SMS ou WhatsApp apropriado | Contratação e eventuais cobranças separadas |

Esta opção não usa R2. Mantenha Workers no plano Free e acompanhe o consumo. O domínio registrado continua tendo a sua renovação própria; hospedagem gratuita não elimina essa despesa.

O GitHub Free permite repositórios públicos. Uma Release aceita até 1.000 arquivos, cada um com menos de 2 GiB; a documentação não define limite de tamanho total da Release nem de banda. Isso comporta os instaladores atuais, mas continua sujeito às políticas do serviço. Use **Release assets**, sem colocar o EXE grande no histórico Git. [Planos do GitHub](https://docs.github.com/en/get-started/learning-about-github/githubs-plans), [limites de Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [limites de arquivos no Git](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits).

### Limites que precisam ser acompanhados

| Recurso no plano Free | Limite consultado em 19/10/2026 |
| --- | --- |
| Invocações do Worker | 100.000 por dia por conta |
| CPU do Worker | 10 ms por invocação |
| Arquivo individual em Static Assets | 25 MiB |
| Arquivos estáticos por versão do Worker | 20.000 |
| D1: linhas lidas | 5 milhões por dia |
| D1: linhas gravadas | 100.000 por dia |
| D1: tamanho deste banco no Free | 500 MB |
| D1: armazenamento total por conta | 5 GB, até 10 bancos |
| D1: recuperação Time Travel no Free | 7 dias |

As requisições atendidas diretamente pelos arquivos estáticos não consomem invocações do Worker. API e páginas geradas pelo Worker consomem; configurar `run_worker_first` para todas as URLs também faz as visitas a arquivos passarem pelo Worker. Por isso, não coloque os instaladores no diretório de assets: o EXE e o ZIP de fontes ultrapassam 25 MiB. [Limites de Workers](https://developers.cloudflare.com/workers/platform/limits/), [cobrança e roteamento de assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

As cotas diárias do D1 reiniciam às 00:00 UTC. Ao ultrapassar leitura ou escrita, as consultas deixam de funcionar até o reinício ou mudança de plano; atingir o armazenamento também impede novas operações que precisem de espaço. Índices e varreduras influenciam o consumo: uma resposta com poucas linhas pode ter lido muitas. [Preços e métricas do D1](https://developers.cloudflare.com/d1/platform/pricing/), [limites do D1](https://developers.cloudflare.com/d1/platform/limits/).

**ZapChat exige atenção:** como exemplo de dimensionamento, uma consulta a cada 25 segundos gera cerca de 3.456 requisições por usuário conectado durante 24 horas. Só 29 usuários nesse ritmo já ultrapassariam 100.000 requisições, antes de cadastros, autenticação e outras chamadas. O cálculo é ilustrativo: reconexões, mensagens e a implementação de polling mudam o consumo. Suspenda consultas quando a tela não estiver ativa, aplique espera progressiva em erros e acompanhe requisições e linhas lidas no painel. A faixa gratuita serve para iniciar; não é uma promessa de escala ilimitada sem custo.

## 2. Publicar os instaladores no GitHub

1. Use o repositório público [zapdmr/zapdmr](https://github.com/zapdmr/zapdmr), já criado na conta autorizada.
2. Conclua a pré-release em rascunho `v1.3.0`. APK, instalador Windows, ZIP de código-fonte correspondente e SHA-256 já foram enviados como quatro assets. Mantenha GPL e os avisos de componentes no pacote de fontes.
3. Publique a Release e copie o endereço de cada asset. Prefira URLs de uma versão específica, evitando trocar um instalador silenciosamente.
4. Coloque essas URLs nas variáveis `DOWNLOAD_ANDROID_URL`, `DOWNLOAD_WINDOWS_URL` e `SOURCE_URL` do Worker e publique a configuração. Elas permanecem vazias no estado registrado aqui.

Formato esperado após a publicação — confirme os nomes reais dos assets antes de usar. Estes exemplos não afirmam que a Release já esteja disponível:

```text
https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Android-1.3.0.apk
https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Setup.exe
https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Android-1.3.0-source.zip
```

**O formulário obrigatório vale para o fluxo do portal.** Os assets de uma Release pública podem ser baixados diretamente, compartilhados ou encontrados no GitHub sem cadastro. O token temporário do portal não transforma esses arquivos em privados. Esta arquitetura não garante cadastro de toda pessoa que receber o aplicativo. O código-fonte GPL permanece acessível sem formulário. [Como criar e publicar uma Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

Nunca envie banco de cadastros, telefones, conversas, exports, arquivos `.env`, `.dev.vars`, chaves de assinatura Android, arquivos DPAPI nem senhas para GitHub, Releases ou `public/`.

## 3. Configuração do Worker e D1

**A instalação, o login e a criação/inicialização do banco remoto já foram concluídos nesta implantação.** Não execute novamente a criação do banco ou o esquema apenas para atualizar assets e URLs. Os comandos abaixo documentam o preparo de uma implantação nova. Use esta pasta, `outputs/site/cloudflare`, e confira a conta antes de qualquer alteração remota.

```powershell
npm install
npx wrangler login
npx wrangler whoami
npx wrangler d1 create zapdmr-community
```

Em uma implantação nova, copie o `database_id` retornado para `wrangler.jsonc`, mantendo o binding **`DB`** e o nome de banco escolhido. A configuração atual já contém o ID remoto indicado na tabela acima. A API usa `env.DB`; um arquivo SQLite local não substitui esse binding. [Introdução ao D1](https://developers.cloudflare.com/d1/get-started/).

Somente para um banco novo, depois de preencher a configuração e revisar `schema.sql`, inicialize o banco remoto:

```powershell
npx wrangler d1 execute DB --remote --file=schema.sql
```

`--remote` altera o banco da conta Cloudflare. O esquema atual já foi aplicado remotamente com 17 comandos concluídos. Para mudanças posteriores, faça backup e revise o SQL antes de aplicar; este arquivo não é um sistema automático de migrações versionadas. [Comandos D1](https://developers.cloudflare.com/d1/wrangler-commands/).

### Variáveis públicas de configuração

Preencha em `vars` de `wrangler.jsonc` ou no painel do Worker:

| Nome | Valor necessário |
| --- | --- |
| `PUBLIC_ORIGIN` | `https://www.zapdmr.com.br` |
| `OWNER_NAME` | `Rizandro Cesar da Silva` |
| `PRIVACY_EMAIL` | `rizandro@gmail.com` |
| `DOWNLOAD_ANDROID_URL` | URL HTTPS do APK na Release publicada |
| `DOWNLOAD_WINDOWS_URL` | URL HTTPS do EXE na Release publicada |
| `SOURCE_URL` | URL HTTPS do ZIP de fontes correspondente |
| `OTP_DELIVERY_URL` | URL HTTPS do adaptador privado de entrega, quando existir |

Não invente responsável, e-mail nem arquivos publicados. O `../public` contém somente os assets do portal. O banco D1 armazena os registros privados; as URLs de download não carregam telefones ou indicativos.

### Segredos de produção

Os três segredos já foram gerados, guardados com DPAPI CurrentUser e enviados à produção pelo helper `configure-secrets.mjs`. As chaves AES e HMAC têm 64 caracteres hexadecimais cada e são diferentes; a senha administrativa é aleatória e forte. Não gere chaves novas para uma simples republicação. O helper reutiliza o backup protegido para evitar rotação acidental.

Em outra implantação, os valores também podem ser cadastrados interativamente, sem escrevê-los no código ou no arquivo de configuração:

```powershell
npx wrangler secret put DATA_ENCRYPTION_KEY
npx wrangler secret put DOWNLOAD_SECRET
npx wrangler secret put ADMIN_PASSWORD
```

As duas primeiras chaves devem ser aleatórias, diferentes e ter 64 caracteres hexadecimais cada. Use uma senha administrativa forte com pelo menos 16 caracteres. Guarde cópias em um gerenciador de senhas: trocar ou perder a chave de cifragem sem migrar os dados pode tornar telefones e mensagens existentes ilegíveis.

Quando houver um adaptador de códigos contratado/configurado:

```powershell
npx wrangler secret put OTP_DELIVERY_TOKEN
```

`wrangler secret put` pode criar uma versão e publicá-la imediatamente. Use-o apenas no Worker e na conta preparados para produção. `.dev.vars` é somente para desenvolvimento e deve ficar fora do Git, assim como `.env` e `.wrangler/`. [Segredos do Workers](https://developers.cloudflare.com/workers/configuration/secrets/).

## 4. Ativar confirmação de número e comunidade

O Worker precisa de `OTP_DELIVERY_URL` e `OTP_DELIVERY_TOKEN` válidos. O adaptador recebe POST JSON com `phone`, `code` e `expiresInSeconds`, autenticado com Bearer, e entrega o código por um canal apropriado. O custo e as regras de envio pertencem ao provedor escolhido. Cloudflare Free e GitHub não fornecem SMS ou mensagens de autenticação no WhatsApp.

Sem esse provedor, o cadastro e os downloads podem funcionar, mas **novos usuários não conseguem confirmar o número, entrar no diretório ou iniciar o ZapChat**. Não substitua confirmação por um código público, por aprovação automática nem pelo sucesso de um link `wa.me`. A presença das variáveis indica configuração; a entrega real precisa ser confirmada antes de anunciar que o serviço está operacional.

O botão “Chamar no Zap” usa Click to Chat para abrir a conversa na aplicação oficial ou no WhatsApp Web. Ele não envia uma mensagem pela API em nome do ZapDMR e não incorpora conversas pessoais do WhatsApp ao app. Essa abertura de link não utiliza cobrança de envio de mensagens de uma API do ZapDMR. ZapChat é o chat próprio, e seu consumo fica nas cotas Worker/D1. [Click to Chat oficial](https://faq.whatsapp.com/5913398998672934/?locale=pt_BR).

Telefones e conteúdo do ZapChat são cifrados pela aplicação antes de persistir no banco. Os administradores com acesso às chaves podem decifrá-los; isto **não é cifragem ponta a ponta**. A partilha do telefone continua opcional, separada do cadastro, e a confirmação do telefone não comprova licença ou propriedade do indicativo. Mantenha exclusão de conta, revogação da partilha, limites de abuso e limpeza de cadastros antigos ativos na implantação.

## 5. Domínio publicado e futuras atualizações

A zona está ativa no plano Free com os servidores DNS indicados acima. Os dois domínios personalizados já estão associados ao Worker; a homepage de `www.zapdmr.com.br` foi conferida por HTTPS. O procedimento abaixo fica como referência de implantação/manutenção, sem necessidade de recriar os recursos existentes.

1. No Cloudflare, confirme que a zona `zapdmr.com.br` está **Active** na conta escolhida. Se ainda não estiver, conclua no Registro.br a configuração dos servidores DNS fornecidos pelo Cloudflare. Preserve registros de e-mail existentes.
2. Preencha banco, variáveis e segredos. Publique o Worker com os assets:

   ```powershell
   npx wrangler deploy
   ```

3. Em **Workers & Pages → Worker → Settings → Domains & Routes → Add → Custom Domain**, acrescente `www.zapdmr.com.br`. O Cloudflare configura o DNS e o certificado do domínio personalizado. Um CNAME existente com o mesmo nome deve ser revisado antes: ele pode impedir a associação.
4. Decida também o destino de `zapdmr.com.br` sem `www`: use um domínio personalizado adicional compatível com o Worker ou um redirecionamento para o endereço canônico. Registrar somente `www` não configura automaticamente todos os outros nomes.
5. Aguarde o domínio/certificado ficarem ativos e confira homepage, termos, privacidade, `/v1/status` e os arquivos das duas plataformas. Confirme que o app usa a origem HTTPS definitiva. A API privada não deve ser colocada em cache público.

A verificação HTTPS da homepage confirma sua disponibilidade no momento observado; ainda é necessário conferir o fluxo dos instaladores após publicar a Release e validar a entrega de códigos antes de anunciar a comunidade operacional. [Domínios personalizados do Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## 6. Pendências para concluir a publicação

- Publicar o rascunho da pré-release `v1.3.0` de `zapdmr/zapdmr`, com os quatro assets já enviados.
- Preencher e publicar as URLs reais dos três downloads; conferir downloads e fonte sem cadastro no domínio público.
- Provedor/adaptador de códigos definido, suas credenciais e entrega operacional; necessário para liberar novos usuários na comunidade.
- Confirmar a origem HTTPS definitiva no app e validar o fluxo entre duas instalações reais após ativar o provedor.
- O Worker pode levar até 25 segundos para devolver uma mensagem nova numa consulta pendente. O app 1.3.0 ainda não consome o canal separado `receipts`; leituras aparecem ao sincronizar novamente o histórico.

As verificações funcionais isoladas tiveram 38 resultados aprovados; não substituem a validação de entrega OTP e uso em dispositivos reais. Nenhum código ou mensagem foi enviado a uma pessoa real durante essas verificações. As cotas e condições devem ser acompanhadas após a publicação.
