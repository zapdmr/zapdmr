# Car Preview 09 — navegação e área da rodada

Candidata Android exclusiva para testes. Versão 1.5.3-car-preview.9, código 15309, pacote br.radio.zapdmr.carpreview. Mesma assinatura das Car Preview anteriores; instalar sobre a Preview 08 sem desinstalar ou limpar dados. Não publicada no site. Versões estáveis e artefatos 04–08 preservados.

## Alterações
- Barra inferior fixa com quatro botões iguais: PTT | Modo Carro | Ligação | Definições. Ícones de microfone, automóvel e os ícones existentes de ligação/definições.
- Removido o bloco superior ATIVAR MODO CARRO e sua identificação de build. A identificação da prévia continua em Definições, na entrada Modo Carro, e nas informações Android.
- O novo botão chama a interface simplificada existente. Não conecta, desconecta, cria sessão ou muda TG. O botão SAIR DO MODO CARRO continua visível, com indicação MODO CARRO ATIVO.
- Recuperado o espaço ocupado pelo bloco superior. Mantidos contador, colunas e regras da rodada. A lista continua no mesmo estado e no mesmo DOM ao navegar ou alternar interfaces.
- Tabela ajustada à largura do celular, com rolagem vertical, quebra de nomes/localização e sem largura mínima antiga que obrigava rolagem horizontal. A área da rodada não aumenta/desloca a tela quando entram novos nomes.
- Ajuste para paisagem: cartões ficam contidos acima da barra, com rolagem interna. Barra respeita área segura inferior/lateral e acomoda fonte ampliada.

## Preservação
Nenhum Java do motor, áudio, Bluetooth, MyLink, perfis ou vocoder foi alterado em relação à Preview 08. Ganho 260% padrão e faixa 0–300%, limitador, VOX, PTT, scan, reconexão, ZapChat, atualizadores, credenciais e preferências permanecem. A confirmação física do microfone MyLink continua dependendo do teste no veículo; esta etapa não a substitui.

## Resultados
- Compilação e 24 testes JVM: aprovados, zero falhas/erros.
- Teste de entrada 09: ordem dos quatro botões, remoção do bloco superior, tratamento de erro, área segura e controle de saída: aprovado.
- Teste do controlador: alternância preserva objeto de conexão, TG, configurações e listas de 1/5/10/20 participantes, incluindo entrada simulada durante o modo; nenhum início de TX/conexão/desconexão durante a alternância. PTT tocar/segurar, VOX e ganho salvo seguem aprovados em simulação.
- Navegador: 320×640, 360×760, 412×892 e 740×360; listas de 1/5/10/20 participantes. Fonte ampliada em 125% no tamanho base e na escala da tabela. Sem rolagem horizontal; quatro botões de mesma largura e alvos acima de 44px; rodada acima da barra em todas as combinações finais. Lista de 20 rola internamente.
- Altura da rodada no teste de 20 participantes/fonte normal: 188,6px (320×640), 234,1px (360×760), 388,6px (412×892), 222px (740×360). Não varia ao trocar o número de participantes no mesmo tamanho.
- Navegação real da página local: Modo Carro → sair → Ligação → Definições → PTT preservou as cinco linhas e o contador. Página direta da aplicação sem erros de console na conferência final.
- Captura em images/car-preview-09.png: simulação local com nomes de teste, sem rádio conectado.

Não houve teste em aparelho conectado por USB nem transmissão real nesta etapa. Recepção de operadores reais, comportamento de área segura/escala de fonte específica do Android e uso no carro devem ser confirmados no telefone. Os testes de navegador não comprovam esses pontos físicos.

## Validação no celular
1. Instale o APK sobre a Car Preview atual, sem desinstalar. Abra ZapDMR Car Preview 09.
2. Na tela PTT, confirme os quatro atalhos inferiores e a ausência do botão superior.
3. Conecte seu perfil como de costume. Durante uma rodada, confira indicativo, nome, localização, horário e contador.
4. Toque Modo Carro e depois SAIR DO MODO CARRO; confira que perfil, TG e conexão permanecem. A rodada deve continuar ao retornar.
5. Visite Ligação e Definições e retorne ao PTT. Role a lista quando houver muitos colegas.
6. Confira retrato/paisagem e fonte ampliada. Valide áudio/PTT e MyLink somente com veículo estacionado, seguindo o relatório da Preview 08.

## Reprodução e entrega
scripts/validation/car-entry09.test.cjs e car-ui.test.cjs; scripts/build-car-preview.ps1. Logs locais em work/car-preview-09-final-build.log e work/car09-layout-results.json. APK, fonte completa e SHA256SUMS-09.txt em release/car-preview. Nada foi publicado automaticamente.
