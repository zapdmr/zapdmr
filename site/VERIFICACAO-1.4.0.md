# Verificação ZapDMR 1.4.0 — 20/10/2026

## Implementação

Anexos privados do ZapChat (15 MiB, imagens/documentos/codeplugs, compressão 1280px, prévia e legenda), histórico e troca de contactos isolados, reabertura e recibos. Cache de mídia limitado a 6 arquivos/24 MiB, duas miniaturas simultâneas e carregamento visível. D1 com AES-GCM por bloco e autorização dos participantes. Migração remota 0002: sete comandos, sucesso; 0003 de avisos opcionais: 17 comandos, sucesso. Sem substituição do banco, de chaves ou das contas existentes.

Rádio Windows/Android: mudança de TG/Scan sem bursts DMRD de ativação e sem TG 4000 automático; filtro local impede reproduzir TG antiga. Ativação dinâmica passa a depender do PTT real ou configuração do master. Android: AUDIOFOCUS_GAIN, delayed focus, callback, foreground mediaPlayback e pausa/flush sem interromper a receção de rede.

## Evidências locais

- `zapchat-attachments.test.mjs`: passou autenticação, acesso exclusivo ao par, upload/download íntegro de 15 MiB, validação de conteúdo/extensão, idempotência, cursores, recibos limitados ao recebido, bloqueios e exclusão em cascata.
- `release-notifications.test.mjs`: passou adesão explícita, omissão em app antigo, público elegível, deduplicação, início atômico, cancelamento que preserva OTP, rastreio de solicitação de download e expiração. Nenhum WhatsApp foi enviado por esses testes.
- Dois clientes no navegador, em banco local isolado TEST1A/TEST1B/TEST1C: imagem enviada e recebida, documento CSV enviado/baixado, recibo lida, reabertura e troca para contacto vazio sem mistura.
- Imagem original 1600×900 reduzida a 1280×720, 13,3 KB; lightbox abriu.
- Screenshot local `outputs/work/zapchat-anexos-verificados.png`.
- TypeScript compilou. APK release gerado com versionCode 13, assinatura v2/v3 verificada. Windows x64 gerado por Electron/Squirrel. Assets do chat conferidos contra o código-fonte em ambos os pacotes.

## Limites da verificação

Dois clientes locais não equivalem a duas instalações reais Android/Windows. Ainda é necessário instalar 1.4.0 nos aparelhos e conferir envio/recebimento e salvamento nativo, operação de áudio com outra app/chamada e retomada de RX no dispositivo. Não foi realizado teste de PTT ou transmissão real nesta etapa. A troca passiva não garante que o master encaminhe uma nova TG dinâmica sem PTT.

A ponte OTP real da versão anterior já foi confirmada pelo responsável no seu WhatsApp e o número foi validado no portal. A ponte permanece neste PC Windows, ligado e com internet, conforme escolha do responsável. A criação da hospedagem Oracle foi cancelada a seu pedido.

## Avisos de versões

Adesão opcional no site, nunca pré-marcada. Cadastros antigos ficam desativados por padrão. Depois de verificar o número e solicitar instalador, avisos de versões futuras podem ser enfileirados na rotina horária e enviados pela ponte, um por 30 segundos, com prioridade para OTP. PARAR/SAIR/STOP cancela avisos. Resultados incertos não são reenviados automaticamente. Nenhum aviso real foi disparado como teste.

## Fontes técnicas

- Cloudflare D1: https://developers.cloudflare.com/d1/platform/limits/
- Android audio focus: https://developer.android.com/media/optimize/audio-focus
- BrandMeister TG dinâmica/estática: https://help.brandmeister.network/talk-groups/dynamic-vs-static/
