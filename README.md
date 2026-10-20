# ZapDMR 1.3.0 — beta

Cliente de rádio digital para Windows e Android, com TalkGroups DMR, PTT, vocoder local, APRS e comunidade ZapDMR. Projeto para operadores de rádio amador licenciados.

- **Portal:** [www.zapdmr.com.br](https://www.zapdmr.com.br)
- **Distribuição:** [Release v1.3.0](https://github.com/zapdmr/zapdmr/releases/tag/v1.3.0)
- **Responsável:** Rizandro Cesar da Silva
- **Contato e privacidade:** rizandro@gmail.com

## Instalar

Os arquivos são distribuídos como assets da Release, sem guardar executáveis grandes no histórico Git:

| Plataforma / arquivo | Download |
| --- | --- |
| Android | [ZapDMR-Android-1.3.0.apk](https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Android-1.3.0.apk) |
| Windows x64 | [ZapDMR-Setup.exe](https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Setup.exe) |
| Fontes do portal Cloudflare | [ZapDMR-Site-Cloudflare-1.3.0.zip](https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Site-Cloudflare-1.3.0.zip) |
| Código-fonte correspondente completo do aplicativo | [ZapDMR-Android-1.3.0-source.zip](https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Android-1.3.0-source.zip) |

Consulte os hashes SHA-256 anexados à Release antes da instalação. Os assets públicos do GitHub podem ser baixados diretamente sem preencher o formulário do portal.

## O que esta versão oferece

- Sessão HBP/BrandMeister com UDP IPv4; troca de TG com desvinculação/ativação configuráveis e filtro de áudio da TG selecionada.
- PTT na tela, TOT, Scan de um alvo por vez e suporte a botões Bluetooth SPP/porta COM.
- Áudio autônomo no Android; auxiliar de áudio nativo no Windows.
- Last Heard com dados de operadores e indicadores de atividade recente.
- APRS com posição opcional e mensagens; recursos dependem da configuração e do equipamento.
- Cadastro da comunidade, partilha opcional do telefone, diretório autenticado, bloqueios e ZapChat próprio.

**Esta é uma edição beta.** A documentação de implementação e as compilações não confirmam funcionamento de áudio, Bluetooth, GPS e chamadas privadas em todos os aparelhos ou masters. Consulte [as notas 1.3.0](docs/RELEASE-1.3.0.md).

## WhatsApp, ZapChat e autenticação

“Chamar no Zap” abre a conversa na aplicação oficial do WhatsApp ou WhatsApp Web quando o colega autorizou a partilha do número. O envio é feito pelo operador no WhatsApp. O aplicativo não incorpora conversas pessoais do WhatsApp.

ZapChat é o chat próprio do ZapDMR, com mensagens cifradas no servidor; **não há cifragem ponta a ponta**. A confirmação por código valida acesso ao número, sem comprovar licença ou titularidade do indicativo/DMR ID.

**A entrega real de códigos OTP ainda aguarda um provedor/adaptador externo e suas credenciais.** Enquanto isso, novos números não podem ser confirmados e novos usuários não conseguem entrar no diretório/ZapChat. O rádio usa uma sessão independente da comunidade. O app 1.3.0 também não consome o novo canal de recibos ao vivo do backend.

Veja a explicação dos componentes, fluxo de pedidos, credenciais e tokens em [Autenticação](site/AUTENTICACAO.md).

## Código e estrutura do repositório

| Diretório | Conteúdo |
| --- | --- |
| `web/` | Interface compartilhada e cliente da comunidade |
| `src/server/` | Serviço local Windows, HBP, APRS e armazenamento protegido |
| `electron/` | Aplicação desktop e empacotamento |
| `android/` | Fontes Java/XML e configuração Gradle do aplicativo Android |
| `site/` | Portal, API da comunidade, documentação e implantação Cloudflare |
| `scripts/` | Scripts de compilação, empacotamento e verificações existentes |
| `docs/` | Notas e arquitetura |

Este histórico oferece os fontes textuais do aplicativo e do site para leitura e manutenção. Ele **não é, isoladamente, o pacote completo de compilação**: binários, imagens raster, ícones de bandeiras, bibliotecas nativas compiladas, Gradle Wrapper JAR e árvores de dependências nativas de terceiros não estão incluídos. Use o [arquivo de código-fonte correspondente completo da Release](https://github.com/zapdmr/zapdmr/releases/download/v1.3.0/ZapDMR-Android-1.3.0-source.zip) para a distribuição do aplicativo, com suas instruções e componentes. As fontes do site mantidas aqui podem incluir correções posteriores ao pacote do aplicativo 1.3.0.

Configurações específicas da máquina, bancos privados, números cadastrados, conversas, tokens, credenciais de publicação e chaves de assinatura não fazem parte do repositório. Os arquivos de exemplo não contêm os segredos de produção.

## Site e implantação

O portal usa **Cloudflare Workers + D1**, com arquivos pequenos em Static Assets e instaladores no GitHub Releases. O domínio canônico é `https://www.zapdmr.com.br`. Há também um servidor Node/SQLite como alternativa.

Consulte [a implantação Cloudflare](site/cloudflare/README.md), [a documentação do portal](site/README.md) e [o registro de verificação](site/VERIFICACAO-2026-10-19.md) para configuração e pendências. Os planos gratuitos têm cotas; o serviço externo de códigos não é fornecido automaticamente pela Cloudflare ou pelo GitHub.

## Licença

O código do ZapDMR é distribuído sob [GPL-3.0-only](LICENSE). Preserve os [avisos de componentes de terceiros](THIRD_PARTY_NOTICES.md) e as licenças incluídas. Recursos de firmware e dependências têm os próprios avisos e condições descritos no pacote completo e na documentação; não presuma que a GPL do aplicativo altera as licenças desses recursos.
