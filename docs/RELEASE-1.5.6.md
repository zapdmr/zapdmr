# ZapDMR 1.5.6 — APRS-IS

Publicação autorizada pelo responsável após testes físicos aprovados no Android e Windows.

## Correção

- Provisionamento automático APRS-IS para cadastro oficial autenticado, WhatsApp validado e identidade coincidente.
- Credencial automática ou manual guardada por perfil somente após resposta `verified`.
- Restauração da opção APRS ligada/desligada e reconexão após reiniciar o aplicativo.
- Erro explícito quando não há credencial válida; nenhum beacon é enviado antes de o servidor confirmar o login.

## Atualização e preservação

Instalar por cima, sem desinstalar. Perfis, credenciais protegidas, configurações, favoritos, TG selecionada, mensagens, DMR, XLX026, Modo Carro e ZapChat são preservados. A atualização é opcional (`minSupportedCode: 0`) e não altera o layout.

Android só oferece `versionCode` superior ao instalado, valida tamanho, SHA-256, packageId e certificado antes de abrir o instalador, e adia a oferta/preparação durante TX ou RX. Windows seleciona somente versão semântica superior, valida SHA-256 e o manifesto Squirrel e recusa reiniciar enquanto houver transmissão PTT.

## Evidências

- Testes físicos Android e Windows aprovados pelo responsável: persistência de configuração/Passcode e reconexão após reiniciar.
- Android 1.5.6, versionCode 28, package `br.radio.zapdmr`, assinatura v2/v3 e mesmo certificado da 1.5.5.
- Windows 1.5.6 x64: instalador e pacote Squirrel completo.
- Testes automatizados APRS, ciclo de atualização Android/Windows, preservação de perfis e bloqueio de downgrade/PTT aprovados antes da publicação.

Versões anteriores e seus artefatos permanecem disponíveis. A publicação só é concluída após conferir a release, o domínio oficial, os downloads públicos e o manifesto estável.
