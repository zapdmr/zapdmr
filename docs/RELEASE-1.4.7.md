# ZapDMR 1.4.7 — perfis independentes e XLX026

## Configuração

Em **Definições → Perfil → Adicionar**, escolha **XLX026 · Módulo C · TS2**.
O modelo usa xlx026.net, UDP IPv4 62030, Homebrew/MMDVM, módulo C, TS2,
TG 4003 e ESSID vazio. Informe a senha do servidor no campo protegido e guarde.
O modelo aproveita a identidade já preenchida pelo operador; o instalador não
contém indicativo, Radio ID ou senha pessoais predefinidos.

Cada perfil mantém etiqueta, identidade, ESSID, servidor, protocolo, porta,
timeslot, URL, opções RPTO, áudio e preferências. Senhas ficam separadas por
perfil, protegidas por DPAPI no Windows e Android Keystore no Android.
Perfis Android anteriores são migrados para o perfil inicial sem apagar o chat.
O seletor carrega o perfil e inicia ligação se a senha desse perfil estiver guardada.
Criar um perfil não copia a senha do servidor anterior.

## Transporte e segurança operacional

- Handshake RPTL/RPTK/RPTC; autenticação SHA-256 do desafio e senha editável.
- RPTC de 302 bytes, módulo C no campo URL (bytes 98–221), slots TS2.
- RPTO opcional, somente se houver texto configurado; enviado depois do ACK RPTC.
- Nenhum PTT, quadro de voz falso ou TG 4000 é enviado para ativação.
- No perfil XLX, somente grupo TS2/TG 4003 pode ser transmitido por PTT explícito.
- RX aceita tráfego de grupo TS2 entregue pelo socket associado ao master IPv4,
  incluindo destinos 9, 4003 e destinos roteados pelo refletor. O catálogo e o
  Last Heard local apresentam o destino lógico 4003.
- AMBE usa o vocoder existente; medidores, ganho e volume permanecem disponíveis.
- Bloqueio de PTT durante RX local e proteção após a fala; padrão 500 ms.
- Troca encerra sessão/socket e temporizadores, limpa RX, destino privado,
  participantes e medidores antes de carregar outro perfil. Recusada durante TX.
- BrandMeister continua ODTP com seus dados e credenciais independentes.

## Evidência de validação em 22/10/2026

- Compilação TypeScript e testes em servidor UDP IPv4 isolado: RPTL, RPTK,
  RPTC, RPTO, SHA-256, URL C, ESSID vazio, TS2, RX AMBE por destinos roteados,
  PTT explícito, terminador, bloqueio RX/pós-fala e isolamento do HBP convencional.
- API Windows com DPAPI real em diretório de teste: duas senhas independentes,
  troca, configurações BrandMeister preservadas e persistência após reiniciar.
- Handshake real com xlx026.net:62030: login e ACK RPTC aceitos, sem transmitir voz.
  Nenhum pacote de voz chegou durante 45 segundos de observação.
- Regressões: ODTP, seletor estável, áudio 260%, saída rápida, QRZ/cópia,
  sessão do ZapChat e fluxo de atualização Android em ambiente automatizado.

**Validação operacional informada pelo responsável em 22/10/2026:** após receber
os instaladores, o responsável confirmou: “Consegui falar no xlx026 perfeitamente
funcionou tudo” e autorizou a publicação. Esse relato confirma seu teste de fonia;
não constitui uma medição independente feita pela equipe automatizada nem
comprova separadamente todos os aparelhos ou a atualização por cima.
Os testes automatizados de pacotes permanecem documentados separadamente.

## Limite da vinculação passiva

O ACK do RPTC confirma aceitação do login/configuração, não confirma sozinho
o módulo nem recepção disponível. A interface mantém “módulo C solicitado;
aguardando áudio” até observar voz DMR na sessão.

A documentação do XLX026 indica módulo C para DMR e TG 4003 nos aplicativos
compatíveis: https://xlx026.net/llms.txt . O código público consultado do fork
https://github.com/PP5PK/xlxd/blob/master/src/cdmrmmdvmprotocol.cpp
apenas reconhece/acknowledge RPTC e RPTO; não demonstra leitura do campo URL
para vinculação. A configuração efetivamente instalada no servidor pode diferir.
Se o servidor não vincular pelo RPTC/URL, seu administrador precisa habilitar
esse recurso ou informar o parâmetro passivo suportado. O aplicativo não tenta
contornar essa ausência transmitindo automaticamente.

As outras melhorias da 1.4.6 são preservadas. A integração FCM continua preparada,
sem projeto Firebase configurado. O atualizador integrado continua disponível no
Android; Windows utiliza o instalador, como na versão anterior.
