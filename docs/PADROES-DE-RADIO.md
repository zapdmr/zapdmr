# Padrões de rádio para as próximas versões

Decisão do responsável pelo ZapDMR em 20/10/2026, após confirmar o funcionamento da versão 1.4.1: entregar as próximas instalações com a configuração de rádio pronta para BrandMeister.

## Perfil novo

- Rede BrandMeister, protocolo **Open DMR Terminal / ODTP**.
- Master Brasil **7242.master.brandmeister.network**, UDP **54006**.
- TG inicial **724 — Brasil Nacional**.
- Modo padrão do PTT **Tocar — um toque liga, outro desliga**; preservar uma escolha explícita já salva.
- Abrir os seletores de TG em **Nacionais**, mantendo Mundiais e TGs personalizadas disponíveis pelos filtros. O pop-up mantém linhas e indicadores estáveis enquanto estiver aberto.
- Ligar automaticamente com perfil completo e senha guardada; reconexão automática habilitada, com limite de tentativas.
- Ao guardar o perfil completo, iniciar a conexão quando a opção de ligação automática estiver habilitada e não houver outra sessão em andamento.
- Sintonizar uma TG envia inscrição/cancelamento ODTP, sem PTT, portadora silenciosa ou TG 4000. O PTT é reservado à voz solicitada pelo operador.

## Dados individuais, preenchidos uma vez

O operador precisa informar seu indicativo, Radio ID, WhatsApp e sua própria **Hotspot Security Password da BrandMeister**. A confirmação WhatsApp é feita pelo fluxo existente. A senha de rádio é individual e guardada no armazenamento protegido do aparelho; não pode ser substituída por uma senha coletiva no instalador. Microfone e outras permissões são autorizados pelo operador quando necessários.

Depois de salvar os dados, a aplicação pode conectar e restaurar a TG escolhida nas aberturas seguintes. Transmitir voz exige ação do operador; o perfil padrão não habilita VOX.

## Atualizações

Preservar master, protocolo, porta, favoritos, TG selecionada, cadastros personalizados e opções explícitas já salvas. Quem desabilitou conexão/reconexão automática mantém essa escolha. A migração de perfis antigos sem protocolo explícito continua no normalizador. Perfis de outras redes e HBP escolhido explicitamente continuam configuráveis.

Manter a distinção entre conexão, pedido de inscrição, resposta do servidor e áudio recebido. Last Heard global não confirma RX local. Não habilitar transmissão silenciosa como alternativa a falha de ODTP.

Os padrões estão em `web/radio-protocol.js`, `web/app.js`, `src/server/types.ts` e `src/server/index.ts`. A interface compartilhada entrega o mesmo perfil ao serviço Android. Estes ajustes posteriores à 1.4.1 são destinados ao próximo instalador.
