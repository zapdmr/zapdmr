# ZapDMR 1.5.0 — recepção de chamada individual

## Correção Android e Windows

As versões anteriores filtravam chamadas privadas enquanto o operador ouvia
uma TG. Portanto, instalar o menu novo apenas no aparelho do chamador não
corrige o receptor antigo. Atualizar as duas instalações para validar.

- ODTP: após a autenticação e inscrição de grupo, solicita também inscrição
  individual (tipo 5) para o próprio DMR ID. Mantém a TG de grupo (tipo 7).
  Cancelar/trocar a TG reconstrói as inscrições; desconectar encerra a sessão.
  Em destino privado explícito mantém somente a inscrição no próprio ID e
  aceita somente a origem escolhida. Não inscreve o ID do colega como grupo.
- ACKs com payload conferem tipo de chamada e destino. Respostas sem payload
  continuam significando apenas pedido respondido, não voz confirmada.
- Falha/timeout na inscrição individual adicional indica que ela não foi
  confirmada, sem bloquear permanentemente a recepção da TG já inscrita.
- RX ODTP/HBP: aceita voz individual destinada ao próprio Radio ID durante
  escuta da TG. Rejeita outro destinatário e eco próprio. XLX módulo C continua
  restrito a grupo; não é declarado suporte privado ao refletor.
- Intertravamento de RX/decodificação/reprodução e proteção de pelo menos
  500 ms continuam ativos para chamadas individuais.
- Troca do destino privado recusada durante RX e sua proteção, inclusive no
  serviço e na interface, para não apagar o bloqueio ao clicar em responder.
- Aviso de chamada individual recebida, identificação pela base DMR e botão
  **Responder em particular**. A escolha é explícita, não altera a TG salva,
  não transmite e não inicia PTT automaticamente. Há retorno à TG anterior.
- Medidores identificam ID em chamadas privadas, sem rotular o ID como TG.
- Credenciais, perfis, ZapChat, atualização e demais recursos 1.4.9 mantidos.

Referência primária do transporte e inscrições múltiplas tipo 5/7:
https://github.com/abo4/pyspot_rx/blob/main/pyspot_rx.py

## Verificação e limites

Compilação TypeScript/Android/Electron e conferência do empacotamento.
Não foi realizada chamada real entre dois aparelhos nesta revisão, nem envio
ou autenticação de teste na rede. A entrega de voz também depende do master,
DMR IDs corretos e conexão dos dois operadores. Atualizar os dois e validar
RX/TX reais antes de publicar no site. Sem publicação automática desta versão.
