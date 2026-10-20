# Publicação 1.4.1 — 20/10/2026

Catálogo simplificado para 65 TGs: Nacionais (34) e Mundiais (31), com cadastro manual e migração das categorias personalizadas. Detalhes e arquivos em `../docs/RELEASE-1.4.1.md` no pacote-fonte.

ODTP integrado em Windows e Android, com inscrição/cancelamento, estados por confirmação/tráfego e transporte AMBE existente. HBP preservado como alternativa sem inscrição de terminal. Nenhuma ativação com áudio silencioso ou TG 4000 automático.

Testes locais de catálogo, seletores, Scan, ODTP UDP A–G, núcleo Java, anexos do ZapChat e avisos opcionais aprovados. Em conexão real ao master Brasil, ODTP autenticou e entregou 189/196 quadros na TG91 e 98/100 na TG72426 em passagens sucessivas; TG7244 ficou sem voz na janela observada. Ensaio bloqueou qualquer cabeçalho/voz de saída; zero tentativas de áudio e nenhum PTT real. Senha e configurações locais não foram modificadas.

As compilações não substituem teste de alto-falante, microfone e retomada de áudio nos aparelhos. A entrega AMBE pela rede foi confirmada; não se afirma homologação em todos os masters. Publicação permanece beta.

Não houve alteração do banco ou das contas da comunidade, migração D1 nova, envio de WhatsApp de teste nem inscrição retroativa em avisos. A ponte local continua exigindo este PC ligado e conectado.

## Publicação confirmada

Release beta https://github.com/zapdmr/zapdmr/releases/tag/v1.4.1, tag no commit eaff8b66a332c29960ab2c05642242d8811cdab1. Seis assets publicados; tamanho e digest SHA-256 dos quatro pacotes conferidos com o GitHub. APK, EXE, fontes e pacote do site responderam HTTP 200. APK versionCode 14 com assinatura v2/v3; interface Android e código/UI do ASAR Windows conferidos contra as fontes.

Site/API publicados em https://www.zapdmr.com.br, Worker version ID 4544d027-9b6e-4eff-af7e-16bc72931c93. /healthz e /v1/status retornaram 1.4.1, instaladores disponíveis com os novos hashes, ponte WhatsApp conectada e anexos habilitados com limite de 15.728.640 bytes. Sem migração D1 nesta versão.

Reconexão real adicional somente RX: duas sessões ODTP autenticadas na TG91 receberam 97 e 96 quadros, respectivamente; nenhum PTT ou áudio de saída. Testes reais de alto-falante e microfone continuam pendentes. Os arquivos da release foram preservados após publicados; este registro posterior documenta a implantação.