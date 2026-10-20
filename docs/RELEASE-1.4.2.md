# ZapDMR 1.4.2 — perfil pronto para começar

## Mudanças

- Novos perfis BrandMeister usam Open DMR Terminal (ODTP), master Brasil `7242.master.brandmeister.network`, UDP `54006` e TG inicial `724`.
- Conexão e reconexão automáticas são o padrão para perfis completos com dados e Hotspot Security Password individuais.
- Trocar TalkGroup em ODTP atualiza a inscrição de recepção sem PTT silencioso e sem TG 4000.
- Atualizações preservam configurações explícitas já salvas. Nenhuma senha coletiva é incluída.

## Para começar

Informe indicativo, DMR ID e a Hotspot Security Password pessoal da BrandMeister. Conceda as permissões de áudio e selecione uma TG. O app conecta automaticamente quando o perfil está completo; use o PTT somente para transmitir.

## Verificação

O responsável confirmou recepção de áudio após mudar TG em uso real. O APK foi gerado como versionCode 15 / versionName 1.4.2 e a assinatura v2/v3 foi verificada. O instalador Windows x64 foi gerado. A implantação Cloudflare e os links dos dois instaladores foram conferidos ao vivo; veja `site/VERIFICACAO-1.4.2.md`.
