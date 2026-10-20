# ZapDMR 1.4.2 — perfil pronto para começar
 # ZapDMR 1.4.2 — perfil pronto para começar

## Mudanças

- Novos perfis BrandMeister já usam Open DMR Terminal (ODTP), master Brasil `7242.master.brandmeister.network`, UDP `54006` e TG inicial `724`.
- Conexão e reconexão automáticas ficam ativadas por padrão quando os dados e a Hotspot Security Password individuais estão completos.
- Ao trocar TalkGroup no ODTP, o app inscreve a recepção no destino sem PTT, áudio silencioso ou TG 4000.
- Atualizações preservam configurações explícitas já salvas, incluindo quem desligou conexão automática. Nenhuma senha coletiva é incluída no instalador.

## Para começar

O radioamador ainda informa o indicativo, DMR ID e a Hotspot Security Password pessoal da BrandMeister e concede as permissões de áudio. O primeiro perfil conecta automaticamente quando estiver completo. O operador seleciona a TG e usa o PTT apenas para transmitir voz.

## Verificação

O fluxo ODTP e a recepção após troca de TG foram exercitados nas fontes da versão anterior e o responsável confirmou áudio RX na operação real. Esta publicação incorpora os padrões ao perfil inicial. Os builds Android e Windows foram gerados a partir destas fontes; os hashes e as versões internas serão registrados após inspeção dos pacotes.
