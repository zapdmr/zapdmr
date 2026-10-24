# Verificação final — candidata 1.5.3

## Concluído localmente

- Android 1.5.3, versionCode 25, pacote br.radio.zapdmr, minSdk 24.
- APK assinado v2/v3 com o mesmo certificado das versões anteriores: SHA-256 96d4e278deec741c6f2e80b21c9f87f8eed0bcfb39ed3ec9bd5b9e00d4915d5f.
- Windows compilado com Squirrel; EXE, full.nupkg, RELEASES e hashes íntegros.
- O EXE Windows continua sem assinatura Authenticode (NotSigned), como a versão anterior; não foi adquirido certificado nesta tarefa.
- ASAR e assets APK conferidos com as fontes finais. Vocoder e firmware preservados.
- TypeScript, Worker dry-run, esquema SQLite completo e testes onboarding153, onboarding-ui153, server-onboarding153, xlx-session, app-updater e windows-updater152 passaram.
- Verificados revisão crescente de catálogo, recusa de downgrade e reversão de parâmetros por nova revisão assinada.
- Revisão visual no navegador local: formulário legível e recusa de código incompleto.
- Baseline por tamanho/SHA-256: todos os arquivos de distribuição 1.5.1 e 1.5.2 intactos.
- Consulta pública confirmou Android/Windows 1.5.2 no manifesto estável.

## Pendências reais

Não há aparelho Android conectado (adb devices vazio). Não foram realizadas instalação física, atualização real por cima, conexão/RX/TX real desta candidata no XLX026 nem preservação de histórico em duas instalações reais. Os testes de rádio usaram master UDP local. O teste DPAPI usou o Windows real com dados isolados.

O site público permanece na 1.5.2. Os novos endpoints de ativação, botão de gerar código e tabela D1 da candidata não foram implantados. Portanto, gerar o novo código no site ainda não está disponível em produção. A adição recomendada pode utilizar uma sessão de comunidade já autenticada, mas o fluxo completo site → código → app precisa da implantação aprovada e validação acompanhada.

Nenhum instalador foi publicado nesta tarefa. Nenhuma senha pessoal foi distribuída; a chave compartilhada XLX foi autorizada pelo responsável. Nenhuma mensagem WhatsApp foi enviada.

Ver CONFIGURACAO-SIMPLIFICADA-1.5.3.md para arquitetura, lista de arquivos, parâmetros, matriz de testes e plano de distribuição. Publicação depende de aprovação posterior.
