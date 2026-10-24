# Modo Carro — candidata isolada

## Entrega e preservação
Branch local `car-mode-preview`, baseada no código da candidata 1.5.3. Nenhuma publicação, alteração do site ou escolha de próximo número estável. O aplicativo de teste chama-se **ZapDMR Car Preview**, pacote `br.radio.zapdmr.carpreview`, assinado para testes. Instala ao lado do aplicativo normal, com dados próprios. A etiqueta 1.5.3-car-preview identifica a base, não uma nova versão estável. Não importa credenciais automaticamente. O atualizador de produção fica desativado neste pacote.

Abra Definições → Perfil → Abrir Modo Carro. Configure parado. Ao sair, retorna o DOM original; tema, favoritos, perfis e modo PTT normal não são substituídos. O ajuste automático XLX foi adiado conforme solicitado.

## Auditoria do scan
A sessão atual mantém uma TG de grupo por vez, além do endereço individual, e um único pipeline de áudio. O scan legado consulta atividade global; isso não comprova RX local. Ele fica suspenso enquanto o Modo Carro está ativo.

O novo scan alterna inscrições reais ODTP, cancelando a anterior. Aguarda confirmação da inscrição antes da permanência configurada. Só eventos locais de voz aceitos, com origem e destino correspondentes, identificam o interlocutor. Não usa Last Heard global como recepção. Não gera voz, PTT ou TG 4000.

Limitação: é varredura sequencial, não escuta simultânea. Pode perder o começo ou toda uma chamada ocorrida em outra TG. Prioridade intercala visitas, sem interromper RX/TX. Não há scan prometido em HBP/XLX. Ao ir para segundo plano, a varredura para; a sessão nativa pode continuar recebendo a última TG.

Estados: IDLE, SCANNING, RX_ACTIVE, HOLD_AFTER_RX, TX_ACTIVE, RECONNECTING, ERROR. Retenção padrão 4 segundos após o RX e sua proteção; permanência padrão 2,5 segundos após ACK. Falta de ACK por 12 segundos para a varredura. Reconexão reutiliza a política existente do rádio.

## Segurança e controles
PTT momentâneo independente da preferência normal. Confirmação explícita da TG/slot antes de transmitir; mudar destino/perfil ou perder conexão invalida a confirmação. Bloqueio durante RX e proteção mínima de 500 ms. TOT de 180 segundos no Modo Carro. Pointerup/cancel, perda de foco e desconexão do acessório encerram o PTT. Heartbeat nativo encerra toque sem atualização por 1,6 segundos. VOX não inicia TX neste modo.

SPP reutiliza o controlador existente, exigindo comandos distintos de pressionar/soltar. A configuração normal não é reescrita. Entrada por Bluetooth exige opção explícita e endereço autorizado; funciona com aplicativo vivo, não é serviço de inicialização com aplicativo encerrado. Não muda de tela durante TX.

Áudio usa AudioTrack/AudioRecord existentes e APIs de dispositivo preferido/comunicação. Dispositivo solicitado e rota confirmada são distintos; confirmação do Android não comprova som audível. A2DP normalmente é saída de mídia, não microfone; SCO/HFP e LE Audio dependem do Android e da central. Rota padrão preserva a política normal. Nenhuma compatibilidade física com veículo foi comprovada nesta entrega.

## Compilação e código
Execute `scripts/build-car-preview.ps1`. APK e SHA256 em `release/car-preview/`. Testes de scanner/UI em `scripts/validation/car-*.test.cjs`; estado nativo em CarModeStateTest. Fontes GPL correspondentes acompanham o APK.

Ver também MODO-CARRO-TESTES.md, ANDROID-AUTO-VIABILIDADE.md e MODO-CARRO-ARQUIVOS.txt.

## Refinamento visual da candidata
Painel com PTT circular momentâneo, indicador vermelho durante TX, atalhos Favoritos, TG rápida e Reconectar. Modo normal sempre acessível. TG rápida usa a seleção existente, bloqueia troca durante RX/TX e invalida a confirmação do destino. Reconectar reutiliza as credenciais protegidas do perfil e nunca inicia PTT. Todos os estilos ficam limitados ao Modo Carro.
