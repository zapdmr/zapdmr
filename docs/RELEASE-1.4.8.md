# ZapDMR 1.4.8 — Windows

## PTT e recepção

O bloqueio de novas transmissões considera os pacotes locais HBP/ODTP do destino
selecionado e a reprodução real no Windows: decodificação, fila PCM e buffer
WASAPI. O bloqueio independe do volume/amplitude: silêncio recebido também ocupa
o canal. Após o término, há proteção mínima de 500 ms; a proteção de perda de
pacotes continua existindo quando o terminador não chega.

O botão fica desativado e indica **RX OCUPADO — AGUARDE**. F9 global, botão de
mídia, mouse, VOX e SPP passam pelas proteções da interface e do serviço. Pedidos
recusados não ficam enfileirados para transmitir depois. Parar um TX existente
continua permitido. Last Heard global não determina o bloqueio. Uma recepção
com o mesmo Radio ID também bloqueia quando o operador está escutando; eco do
próprio TX ativo não é reproduzido nem tratado como outro operador.

## Atualizador Windows

- Ao abrir, consulta silenciosamente as releases oficiais do GitHub.
- Em **Definições → Base e backup → Verificar atualizações**, permite consultar
  novamente (intervalo mínimo de 60 segundos entre consultas).
- Baixa a nova versão em segundo plano, avisa na interface e apresenta
  **Reiniciar e atualizar** quando o Squirrel concluir a preparação.
- O download deve conferir tamanho, SHA-256 publicado pelo GitHub e SHA-1 do
  manifesto Squirrel antes de preparar o pacote. O feed de preparação é local,
  com token aleatório e restrito ao loopback; não expõe perfis ou credenciais.
- Reiniciar exige confirmação e recusa durante TX. Antes de aplicar, desativa
  a reconexão da sessão atual, fecha rádio, sockets e áudio sem alterar a
  preferência permanente de conexão automática. A nova abertura restaura os
  dados existentes.
- Sem internet, erro de integridade, limite de consultas ou falha de download,
  a versão instalada continua disponível. Pode tentar outra vez nas Definições.
- A edição beta utiliza tags numéricas oficiais `vX.Y.Z`, inclusive releases
  marcadas como prerelease. Não instala versões iguais ou inferiores.
- Não depende do cadastro/WhatsApp nem faz consultas ao banco D1.

### Primeira instalação e publicação

Quem está no Windows 1.4.7 ou anterior precisa instalar a 1.4.8 manualmente uma
vez. Depois, este atualizador permite receber as próximas versões sem procurar
o `.exe` no site. Funciona na instalação Squirrel; execução da pasta de
desenvolvimento/portable não oferece atualização automática.

Em cada release futura, publicar **juntos**, no repositório `zapdmr/zapdmr`:

1. `ZapDMR-Windows-X.Y.Z.exe` para primeira instalação.
2. `zapdmr-X.Y.Z-full.nupkg` para atualização interna.
3. `RELEASES` contendo a linha desse pacote.
4. `SHA256SUMS.txt` e código-fonte correspondente.

`scripts/build-windows.ps1` prepara o conjunto em `release/windows-X.Y.Z/`.
O atualizador ignora releases que não tenham pacote/manifesto compatíveis;
publicar apenas o `.exe` não habilita a atualização interna. O Windows/Squirrel
pode aplicar uma versão já preparada na próxima abertura normal mesmo que o
operador escolha **Agora não** no convite para reiniciar imediatamente.

## Preservação e alcance

Perfis BrandMeister/XLX026, credenciais protegidas por perfil, ZapChat, áudio,
seletores, indicadores, TGs e preferências são preservados. O Android permanece
na 1.4.7 nesta entrega; não foi gerado novo APK.

Compilação TypeScript e compilação nativa C++ do Windows executadas. A validação
de áudio com outro operador e a atualização real entre duas versões instaladas
dependem de uma sessão real; não são declaradas como realizadas nesta entrega.

O responsável confirmou o funcionamento da versão e autorizou a publicação em
22/10/2026. Essa confirmação é do operador; não substitui uma medição independente
nem confirma especificamente uma atualização entre duas instalações diferentes.
