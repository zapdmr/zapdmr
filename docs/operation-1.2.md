# Operação ZapDMR 1.2 — Android e Windows

## Escuta e localização

O card de escuta na aba PTT controla o mesmo scan passivo do catálogo. Selecionar
TG ou iniciar o scan não envia key-up, DMRD ou PTT. O áudio só pode ser ouvido
quando o master o encaminha para a sessão HBP (por configuração estática ou
vínculo existente). Ver atividade global não concede acesso ao áudio de toda TG.

A atualização da base DMR ID consulta o CSV público do RadioID a pedido do
operador. O cadastro fica privado no dispositivo: SQLite no Android e arquivo
local no Windows. Uma atualização inválida não substitui a base anterior.
Registos, tamanho e data são calculados da base real, sem valores simulados.
IDs e indicativos da rodada são resolvidos novamente após atualizar a base.

Cidade, estado/distrito e país vêm do cadastro do ID. A bandeira é resolvida pelo
país, não pelo slot. Valores numéricos não são usados como localização. Um
cadastro sem localização é mostrado como “Localização não informada”; não se
trata de GPS nem de confirmação da posição física atual do operador.

## PTT, botões e VOX

- **Manter**: premir mantém TX; soltar, cancelar ou perder captura libera TX.
- **Tocar**: um toque inicia e outro termina; existe parada de emergência.
- Android: botões HID/F9, volume configurado e botões de média de auscultadores;
  a integração Bluetooth usa MediaSession e rota SCO quando disponível.
- Windows: F9 global e MediaPlayPause opcional alternam TX; o botão na janela
  respeita Manter/Tocar. A reserva de atalhos depende do sistema/acessório.
- Android: “Falar com o ecrã bloqueado” exige permissão do microfone e serviço
  em primeiro plano. Use o modo Tocar ou botão físico para controlar TX bloqueado.
- Os bips são locais, não são inseridos como pacotes de voz na rede.
- O cartão VOX só revela suas opções após manter o botão por cinco segundos.
  Há limiar em dBFS e espera de silêncio; o TOT corta a fala e exige silêncio
  antes de uma nova ativação VOX. Windows VOX usa captura WebAudio com janela
  ativa; Android usa AudioRecord no serviço. Use auscultadores para evitar
  realimentação do áudio recebido.

## Ecrã e energia

Tema, medidores, colunas e pré-visualização são partilhados entre plataformas.
Android usa FLAG_KEEP_SCREEN_ON e acesso às definições do sistema para a
exceção de bateria; Windows usa powerSaveBlocker. A permissão/exceção de bateria
continua a ser uma decisão do operador no Android.

As preferências são guardadas no perfil. O botão TX pode ser ocultado em repouso,
mas fica visível durante TX, além da parada de emergência nas Definições.

## Ajuste de microfone e teste local (1.2.1)

Os controles de ganho TX e volume RX aplicam os valores no motor ativo sem
reconexão e guardam as preferências. No Android, o RX agora usa ganho PCM real
até 200%, em vez de limitar o AudioTrack a 100%. O VU Android usa a mesma escala
em dBFS do auxiliar Windows. Ganho de 200% corresponde a aproximadamente +6 dB;
reduza se a voz distorcer.

**Testar áudio e vocoder** realiza codificação/descodificação e reprodução local.
**Testar microfone** grava três segundos e reproduz a voz passando pelo vocoder.
Esses testes não armam PTT nem geram DMRD. No Android, o teste usa o serviço nativo,
não a API Windows. No Windows, a interface aguarda a confirmação do auxiliar.
Falhas mostram a mensagem real do motor/dispositivo. A audição pelo operador
continua necessária para confirmar volume, saída correta e qualidade da voz.

## Verificação realizada e limite

Compilação TypeScript e Java Android, sintaxe JavaScript, inspeção visual do
frontend e empacotamento dos dois aplicativos. Não foi feito teste de transmissão
nem teste com acessórios Bluetooth/dispositivo Android físico nesta alteração.
