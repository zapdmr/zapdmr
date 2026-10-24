# Configuração simplificada — candidata 1.5.3

## Estado

Somente desenvolvimento local. Android versionCode 25 e Windows 1.5.3.
O responsável confirmou que o administrador autorizou distribuir a senha
compartilhada do XLX026. Ela é uma chave pública de acesso ao refletor, não uma
senha de conta, de administração ou da BrandMeister. Os instaladores públicos
1.5.1 e 1.5.2 permanecem intactos. O site e o manifesto estável continuam na 1.5.2.

## Arquivos modificados / acrescentados

- `site/cloudflare/onboarding.mjs`, `api.mjs`, `worker.mjs`, `schema.sql` e
  `migrations/0007_onboarding.sql`: ativação, sessões individuais, preferências
  cifradas, rota pública de parâmetros sem D1 e CORS PUT.
- `site/public/site.js`: gerar/copiar código após a confirmação WhatsApp.
- `site/public/config/radio-profiles.json`: catálogo público assinado.
- `web/radio-presets.js`, `official-profiles.js`, `onboarding.js`: parâmetros
  assinados, cache válido offline, entrada simplificada e importação aditiva.
- `web/community.js`: sessão protegida e identidade confirmada importadas;
  preferências gerais separadas das credenciais/permissões locais.
- `web/app.js`, `quick-profiles.js`, `index.html`, `styles.css`: seletor
  DMR/XLX026 mantido, perfil recomendado, diálogo responsivo e criação sem trocar
  o perfil ativo.
- `src/server/index.ts`, `types.ts`: criação aditiva, metadados da recomendação e
  senha exclusiva por perfil no DPAPI.
- `android/.../MobileAudioPlugin.java`: criação aditiva sem desconectar a sessão
  atual; chave pública do XLX guardada no mesmo armazenamento cifrado dos perfis.
- `scripts/sign-radio-presets.cjs`, `package-android-source.ps1`: assinatura e
  inclusão das fontes; versões em package.json/package-lock.json/build.gradle.
- `scripts/validation/*153*`: testes específicos desta candidata.

## XLX026 — parâmetros e evidências

| Campo | Valor | Evidência |
|---|---|---|
| Nome | XLX026 BRASIL | Nome solicitado pelo responsável |
| Host | xlx026.net | Domínio oficial e perfil validado anteriormente |
| IPv4 consultado | 82.152.175.30 | DNS A consultado nesta tarefa; não fixado no aplicativo |
| Transporte | HBP, UDP 62030, IPv4 | Implementação e teste real da versão anterior confirmado pelo responsável |
| Slot | TS2 | Perfil já validado e teste local de pacotes |
| Módulo | C, no campo URL do RPTC | Referência oficial e handshake já implementado |
| TG de voz nos apps | 4003 | Referência oficial; não confundir com TG 6 dos hotspots |
| ESSID / TGs estáticas | vazios | Perfil solicitado |
| Senha pública compartilhada | p4ssw0rd | Autorização de distribuição confirmada pelo responsável nesta tarefa |
| Reconexão | habilitada | Política existente; não inicia PTT |

Fontes oficiais consultadas:
https://xlx026.net/ai-context.json
https://xlx026.net/llms.txt
https://xlx026.net/suporte

A documentação pública confirma módulo C e TG 4003 para aplicativos. Ela NÃO
foi apresentada como fonte da senha ou da porta. A autorização da senha veio do
responsável; a compatibilidade de porta/handshake veio da implementação já
testada anteriormente. Nesta candidata não foi repetida uma chamada real no
servidor. Não confundir simulação UDP local com áudio ouvido no XLX026.

HBP usa UDP e não oferece TLS/cifragem da voz. HTTPS protege ativação e catálogo;
armazenamento nativo protege credenciais locais. Não prometer áudio cifrado.

## Cadastro, ativação e segurança

1. O site mantém o cadastro/OTP e a vinculação de indicativo, DMR ID e telefone
   existentes. Conhecer somente indicativo e DMR ID não autoriza ativação.
2. Somente uma sessão verificada pode gerar o código de ativação. O código tem
   128 bits aleatórios, formato de 8 blocos de 4 caracteres e validade de 10 min.
   Não é o código WhatsApp de 6 dígitos. Nenhum dado pessoal entra na URL.
3. Somente o hash HMAC do código é guardado. Gerar outro invalida o anterior.
   `DELETE ... RETURNING` consome a capacidade atomicamente: reutilização,
   expiração e corrida de dois dispositivos não criam duas sessões.
4. A troca cria uma sessão/refresh token próprios do aparelho, com rotação e
   revogação já existentes. Os tokens e telefone vão para Keystore/AES no Android
   e DPAPI no Windows. Não são embutidos no APK/EXE ou no catálogo.
5. O aplicativo cria perfis adicionais com os dados autorizados. Preserva perfil
   ativo, senhas, TGs e preferências de rádio existentes. Não copia senha BM para
   XLX nem vice-versa. Repetir a adição não duplica a mesma recomendação.
6. O usuário toca em CONECTAR AO XLX026; não há conexão/PTT disparado pelo ato de
   importar. A próxima abertura respeita perfil selecionado e política anterior.
7. Se o aparelho já estiver autenticado em outra conta, a ativação é recusada;
   não substitui silenciosamente a sessão do ZapChat.

Primeira instalação sem internet não consegue autenticar um cadastro remoto.
Mostra orientação e permite adiar. Depois da ativação, perfis e último catálogo
válido continuam locais. O master ainda precisa de internet para RX/TX.

## Preferências entre dispositivos

Carregar/salvar na conta é explícito. Transfere identidade autenticada, perfil
oficial autorizado e somente rede preferida, tema e som do ZapChat. A importação
não troca a sessão de rádio ativa. A rede preferida é apresentada ao operador;
ele escolhe quando conectar. Senha BM, áudio, Bluetooth/SPP, permissões e chaves
privadas permanecem locais. A gravação usa revisão otimista: conflito entre dois
aparelhos exige recarregar, evitando sobrescrita silenciosa.

Não se distribui uma cópia do refresh token entre aparelhos. Cada novo aparelho
recebe um código e uma sessão novos. Sessões de comunidade podem coexistir; dois
clientes de rádio com o mesmo ID/ESSID podem ser recusados pelo master. Desligar
o rádio de um antes de ligar o outro. Não inventar ESSIDs para contornar limites.

## Parâmetros públicos centralizados

HTTPS oficial + assinatura ECDSA P-256/SHA-256 com chave pública fixada no app.
O cliente valida assinatura, esquema, limites, protocolo, módulo, slot e TG.
Rejeita revisão menor ou payload divergente com a mesma revisão. Armazena somente
configuração assinada no cache e conserva a última válida se a rede falhar.

Para alterar parâmetros públicos: editar `docs/radio-profiles-public.json`,
incrementar `revision`, confirmar compatibilidade e executar:

`node scripts/sign-radio-presets.cjs docs/radio-profiles-public.json`

Isso prepara o JSON assinado e o fallback embarcado. Após testes/aprovação,
implantar o asset HTTPS. A chave privada fica em `work/radio-preset-key.dpapi`,
protegida por DPAPI CurrentUser e excluída dos pacotes. Preservar cópia privada
protegida; perder essa chave exige nova chave pública e atualização dos apps.
Não regenerar uma chave diferente ao publicar alterações para apps existentes.
Para reverter parâmetros, assinar uma revisão MAIOR com os valores anteriores.

Os perfis personalizados nunca são reescritos. Uma nova recomendação assinada
pode ser adicionada explicitamente, mantendo o perfil anterior para reversão.
Não aplicar host/porta novos durante RX/TX. Não há transmissão automática.
GET do catálogo usa asset estático e não acessa D1. Preferências só são gravadas
ao salvar; emissão/resgate de código são ações explícitas, não polling.

## Verificações e limites

| Cenário solicitado | Resultado desta tarefa |
|---|---|
| Novo cadastro confirmado no site | Mecanismo OTP preservado; emissão validada com usuário verificado em SQLite local |
| Ativação Android e Windows | Fluxo compartilhado testado em harness; instalação física pendente |
| Indicativo e DMR ID corretos | Teste do serviço e teste de importação da interface |
| Perfil XLX automático | Adição idempotente e parâmetros verificados em testes |
| Autenticação XLX | Handshake em servidor UDP local; teste real anterior não substitui nova chamada |
| RX, TX e PTT | Teste UDP local de DMRD/terminador e bloqueio RX + 500 ms; áudio real pendente |
| Alternância / retorno ao último perfil | API Windows em diretório isolado, credenciais DPAPI reais e reinício do servidor local |
| Queda de internet / reconexão | Política anterior preservada; catálogo offline testado; queda real do rádio pendente |
| Instalar sobre versão antiga | Sem mudança de packageId/certificado/userData; instalação física pendente |
| Perfis personalizados | Teste aditivo preserva perfil ativo, áudio e segredos independentes |
| Instalação sem internet | Catálogo embarcado validado; ativação remota não pode acontecer offline |
| Código inválido / expirado / usado / concorrente | Testes SQLite passaram |
| Mesmo cadastro em dois aparelhos | Duas sessões independentes verificadas em SQLite; dois aparelhos reais pendentes |
| Atualização de parâmetros públicos | Assinatura/adulteração/cache testados; implantação real não executada |
| Mensagens / preferências / histórico | Nenhuma migração destrutiva nessas tabelas; leitura/escrita real do histórico de usuários não executada |
| Consumo D1 | Catálogo público com getter DB que falha: nenhum acesso; leituras de preferências sem escrita no serviço |

Testes: `onboarding153.test.mjs`, `onboarding-ui153.test.cjs`,
`server-onboarding153.test.cjs`, `xlx-session.test.cjs`; TypeScript, build Android
e Windows, Worker dry-run e revisão visual local. O teste DOM usa simulação;
o teste DPAPI usa proteção real do Windows em dados de teste. Nenhum desses
testes equivale a instalar/operar em dois aparelhos reais. `adb devices` não
encontrou Android conectado nesta tarefa.

## Implantação e distribuição — somente após aprovação

1. Validar a candidata em Android físico e Windows, incluindo instalação por
   cima, permissões, áudio, troca de redes, histórico e preservação dos perfis.
2. Aplicar apenas a migração aditiva `0007_onboarding.sql` no D1 remoto antes de
   implantar o Worker. Fazer backup e revisar a migração; não executar schema.sql
   sobre uma base existente. Nada disso foi aplicado em produção nesta tarefa.
3. Implantar site/API e catálogo assinado no domínio oficial e conferir ativação
   real com o responsável antes de anunciar o novo fluxo.
4. Publicar APK/EXE, nupkg, RELEASES, hashes e fonte correspondente juntos em
   v1.5.3; só então atualizar os links/manifesto estável. Manter 1.5.1 e 1.5.2.
5. A 1.5.2 poderá oferecer a candidata quando ela virar estável. Instalações
   antigas cujo atualizador falhe precisarão instalar manualmente uma vez. Não
   desinstalar. O novo item nas Definições permite ativar/adicionar perfis depois,
   sem outra reinstalação e sem apagar o cadastro local.

Os instaladores desta candidata não levam dados pessoais ou credenciais de um
operador. A única chave embarcada de acesso é a chave pública compartilhada do
XLX, autorizada nesta conversa. Publicação ainda depende de aprovação posterior.
