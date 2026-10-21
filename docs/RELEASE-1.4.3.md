# ZapDMR 1.4.3 — PTT simples e seletor de TG estável

## Mudanças

- O modo padrão do PTT passa a ser **Tocar — um toque liga, outro desliga** em novas instalações e em instalações sem uma preferência de modo já guardada.
- Preferências existentes são preservadas: quem já escolheu **Manter** continuará com esse modo após atualizar.
- A lista móvel de TalkGroups usa linhas mais compactas, altura previsível, nomes truncados sem quebra e controles com área de toque estável.
- O seletor rápido de TalkGroup usa tipografia menor em telas móveis.
- O menu nativo Android foi substituído por uma janela compacta do ZapDMR, com busca e filtros. As linhas e as bolinhas de atividade verde/vermelha são congeladas ao abrir; atualizações de rede não recriam as opções nem mudam a posição de rolagem durante a escolha.
- Os seletores do PTT e da aba Ligação começam em **Nacionais**; Mundiais e cadastros do usuário continuam disponíveis.
- Confirmação WhatsApp distingue limite temporário de tentativas de indisponibilidade do serviço e usa o prazo restante informado pelo servidor. O ajuste da API e do portal foi publicado em 21/10/2026 no deploy `92c63823-aafd-47ed-98de-1460235a5b64`; a interface do app acompanha esta versão.

## Estado

APK Android versionCode 16 / versionName 1.4.3 gerado e assinado com a chave de atualização existente (assinaturas v2/v3 verificadas). Instalador Windows x64 gerado. Os arquivos da interface dentro do APK e do pacote Windows foram comparados com os fontes finais.

O teste de regressão simulou 120 atualizações de atividade/seleção e confirmou a preservação das linhas, da rolagem e do ID associado ao toque. Catálogo, categorias e seleção sem PTT também passaram nas verificações locais. A prévia visual foi conferida em uma janela de 360 px, com linhas de 44 px e sem transbordamento horizontal. A confirmação do comportamento no Android físico cabe ao operador; não foi alegado teste remoto no seu aparelho.
