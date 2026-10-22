# Verificação da versão 1.4.6

Android versionCode 19, assinatura v2/v3 e mesmo certificado da versão 1.4.5. Todos os 21 arquivos web do APK e do pacote Windows foram comparados com as fontes finais. Auxiliar Windows atualizado para ganho TX/RX até 260%.

Android: 8636362 bytes; SHA-256 e6a47b83b17d6eea038a1180d1fc7a1a566e97c0a72ec62465be81737ed2e2ed.

Windows: 160720384 bytes; SHA-256 d10bb8bbdf42dc1f50ac917c9e183b199a5575eaaa9c07f44c520710aa9650ca.

Testes locais: OTP moderno/legado, sessão renovável/revogável, caixa de entrada, entrega/leitura, isolamento, anexos 15 MiB, reenvio sem duplicatas, painel/manifesto de versões, Sim/Não da atualização, ODTP, proteção RX+500ms, saída rápida e estabilidade do seletor. Envio e resposta em duas contas fictícias no navegador; sessão/histórico recuperados após recarga. Motor Windows real aceita 260%, rejeita 261% e preserva comando antigo.

Migrações 0004, 0005 e 0006 são aditivas e foram aplicadas no D1 preservando os registros anteriores.

Não houve teste acústico/instalação em telefone físico ou troca entre duas instalações reais. Integração Firebase preparada e desativada sem configuração; entrega FCM externa pendente do projeto do responsável. O chat funciona independentemente do Firebase.

Relatório completo: docs/RELEASE-1.4.6.md e docs/FIREBASE-ZAPCHAT.md no repositório.
