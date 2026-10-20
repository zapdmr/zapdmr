# Padrões permanentes do ZapDMR

Antes de alterar perfis, conexão, seleção de TG ou empacotamento, leia `docs/PADROES-DE-RADIO.md`.

Requisito do responsável: novos perfis BrandMeister devem vir com ODTP, master Brasil 7242, UDP 54006 e TG 724. A conexão automática só começa com dados individuais completos e senha guardada. O PTT não deve ser simulado para ativar TGs; ODTP usa inscrição/cancelamento. Nunca enviar TG 4000 automaticamente.

Preserve configurações e opções explícitas existentes durante atualizações. O instalador não deve conter credenciais de um operador. Não confunda atividade global Last Heard com áudio recebido pela sessão local.
