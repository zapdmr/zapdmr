# Padrões permanentes do ZapDMR

Antes de alterar perfis, conexão, seleção de TG ou empacotamento, leia `docs/PADROES-DE-RADIO.md`.

Requisito do responsável: novos perfis BrandMeister devem vir com ODTP, master Brasil 7242, UDP 54006 e TG 724. A conexão automática só começa com dados individuais completos e senha guardada. O PTT não deve ser simulado para ativar TGs; ODTP usa inscrição/cancelamento. Nunca enviar TG 4000 automaticamente.

Preserve configurações e opções explícitas existentes durante atualizações. O instalador não deve conter credenciais de um operador. Não confunda atividade global Last Heard com áudio recebido pela sessão local.

## Atualizações Windows a partir da 1.4.8

Preserve o atualizador interno e o bloqueio PTT durante RX local, decodificação e reprodução, com proteção mínima de 500 ms após o áudio. F9, SPP, VOX e mouse não podem contornar o serviço de rádio.

Para cada publicação Windows, envie juntos os arquivos preparados em `release/windows-X.Y.Z/`: instalador `.exe`, `zapdmr-X.Y.Z-full.nupkg`, `RELEASES`, checksums e fonte correspondente. Use a tag numérica `vX.Y.Z` no repositório oficial `zapdmr/zapdmr`. Publicar somente o `.exe` impede a atualização interna. Veja `docs/RELEASE-1.4.8.md`. Preserve dados e credenciais no userData; nunca solicite novo cadastro apenas para atualizar.
