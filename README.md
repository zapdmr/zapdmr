# ZapDMR 1.3.1 — beta

Cliente de rádio digital para Windows e Android, com TalkGroups DMR, PTT, vocoder local, APRS e comunidade ZapDMR. Projeto para operadores de rádio amador licenciados.

- **Portal:** [www.zapdmr.com.br](https://www.zapdmr.com.br)
- **Distribuição:** [Release v1.3.1](https://github.com/zapdmr/zapdmr/releases/tag/v1.3.1)
- **Responsável:** Rizandro Cesar da Silva
- **Contato e privacidade:** rizandro@gmail.com

## Instalar

Os arquivos são distribuídos como assets da Release, sem guardar executáveis grandes no histórico Git:

| Plataforma / arquivo | Download |
| --- | --- |
| Android | [ZapDMR-Android-1.3.1.apk](https://github.com/zapdmr/zapdmr/releases/download/v1.3.1/ZapDMR-Android-1.3.1.apk) |
| Windows x64 | [ZapDMR-Windows-1.3.1.exe](https://github.com/zapdmr/zapdmr/releases/download/v1.3.1/ZapDMR-Windows-1.3.1.exe) |
| Código-fonte correspondente completo do aplicativo | [ZapDMR-Android-1.3.1-source.zip](https://github.com/zapdmr/zapdmr/releases/download/v1.3.1/ZapDMR-Android-1.3.1-source.zip) |

Consulte os hashes SHA-256 anexados à Release antes da instalação. Os assets públicos do GitHub podem ser baixados diretamente sem preencher o formulário do portal.

## O que esta versão oferece

- Sessão HBP/BrandMeister com UDP IPv4; troca de TG com desvinculação/ativação configuráveis e filtro de áudio da TG selecionada.
- PTT na tela, TOT, Scan de um alvo por vez e suporte a botões Bluetooth SPP/porta COM.
- Áudio autônomo no Android; auxiliar de áudio nativo no Windows.
- Last Heard com dados de operadores e indicadores de atividade recente.
- APRS com posição opcional e mensagens; recursos dependem da configuração e do equipamento.
- Cadastro da comunidade, partilha opcional do telefone, diretório autenticado, bloqueios e ZapChat próprio.

**Esta é uma edição beta.** A documentação de implementação e as compilações não confirmam funcionamento de áudio, Bluetooth, GPS e chamadas privadas em todos os aparelhos ou masters. Consulte [as notas 1.3.1](docs/RELEASE-1.3.1.md).

## WhatsApp, ZapChat e autenticação

“Chamar no Zap” abre a conversa na aplicação oficial do WhatsApp ou WhatsApp Web quando o colega autorizou a partilha do número. O envio é feito pelo operador no WhatsApp. O aplicativo não incorpora conversas pessoais do WhatsApp.

ZapChat é o chat próprio do ZapDMR, com mensagens cifradas no servidor; **não há cifragem ponta a ponta**. A confirmação por código valida acesso ao número, sem comprovar licença ou titularidade do indicativo/DMR ID.

**A confirmação exige que a ponte WhatsApp do responsável esteja conectada.** A versão 1.3.1 inclui confirmação reversa, fila de envio automático pela ponte local Baileys, reenvio após 60 segundos e seis dígitos com validade de dez minutos. O responsável vincula o número oficial por QR e mantém o computador ligado. O pareamento e a retomada após reinicialização foram confirmados: a API pública informou a ponte conectada em modo `bridge`. Após a correção r2, o responsável recebeu e validou um código real no portal; o número foi marcado como verificado e o download Android foi liberado. A instalação e a ativação dentro do aplicativo permanecem verificações no aparelho. Consulte [o fluxo de confirmação](site/WHATSAPP-OTP.md) e [o registro de 20/10](site/VERIFICACAO-2026-10-20.md). O rádio usa uma sessão independente da comunidade. O app 1.3.1 também não consome o novo canal de recibos ao vivo do backend.

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

Este histórico oferece os fontes textuais do aplicativo e do site para leitura e manutenção. Ele **não é, isoladamente, o pacote completo de compilação**: binários, imagens raster, ícones de bandeiras, bibliotecas nativas compiladas, Gradle Wrapper JAR e árvores de dependências nativas de terceiros não estão incluídos. Use o [arquivo de código-fonte correspondente completo da Release](https://github.com/zapdmr/zapdmr/releases/download/v1.3.1/ZapDMR-Android-1.3.1-source.zip) para a distribuição do aplicativo, com suas instruções e componentes. As fontes do site mantidas aqui podem incluir correções posteriores ao pacote do aplicativo 1.3.1.

Configurações específicas da máquina, bancos privados, números cadastrados, conversas, tokens, credenciais de publicação e chaves de assinatura não fazem parte do repositório. Os arquivos de exemplo não contêm os segredos de produção.

## Site e implantação

O portal usa **Cloudflare Workers + D1**, com arquivos pequenos em Static Assets e instaladores no GitHub Releases. O domínio canônico é `https://www.zapdmr.com.br`. Há também um servidor Node/SQLite como alternativa.

Consulte [a implantação Cloudflare](site/cloudflare/README.md), [a documentação do portal](site/README.md) e [o registro de verificação atual](site/VERIFICACAO-2026-10-20.md), com [histórico de 19/10](site/VERIFICACAO-2026-10-19.md), para configuração e pendências. Os planos gratuitos têm cotas; o serviço externo de códigos não é fornecido automaticamente pela Cloudflare ou pelo GitHub.

## Licença

O código do ZapDMR é distribuído sob [GPL-3.0-only](LICENSE). Preserve os [avisos de componentes de terceiros](THIRD_PARTY_NOTICES.md) e as licenças incluídas. Recursos de firmware e dependências têm os próprios avisos e condições descritos no pacote completo e na documentação; não presuma que a GPL do aplicativo altera as licenças desses recursos.


## ZapChat 1.4.0

- Anexos privados: fotos, documentos e codeplugs até 15 MiB, prévia, legenda e download; cache e miniaturas com limites de memória.
- Reabertura, troca de contactos, cursores do servidor e recibos de leitura corrigidos.
- Rádio: seleção de TG passiva, sem burst automático; encaminhamento depende do master ou do primeiro PTT. Android com espera e retomada de foco RX.
- Avisos de novas versões por WhatsApp: consentimento separado, opcional e cancelável com PARAR; contas antigas não são inscritas automaticamente.

[Implementação e limites](site/ZAPCHAT-ANEXOS.md) · [Avisos de versões](site/AVISOS-VERSOES.md).

Verificação local com dois clientes e banco isolado concluída. Os novos builds ainda precisam de validação de áudio e troca de anexos nos aparelhos reais. O PC da ponte WhatsApp deve permanecer ligado e online.
