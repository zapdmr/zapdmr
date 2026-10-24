# Auditoria de atualizações — candidata 1.5.2

## Estado e preservação

1.5.2 é uma candidata local. Não publicada, não anunciada e não declarada estável.
A 1.5.1 permanece no site/GitHub e seus APK, EXE, nupkg, RELEASES, hashes,
fontes e assinatura Android não são alterados. O baseline de todos os arquivos
1.5.1 foi salvo em work/audit-updater152/baseline151.json e conferido ao final.
Código de desenvolvimento é 1.5.2, Android versionCode 24. Não mudar packageId,
keystore, userData, perfis, credenciais ou dados da comunidade.

## Achados com evidência

- Android 1.5.1: web/app-updater.js definia checked=true antes da consulta. Uma
  falha inicial era silenciada e nenhuma retomada/online disparava nova consulta.
  Dependia do evento zapdmr:ready, ao fim da inicialização do perfil. Se init
  falhasse antes, o verificador não era iniciado. Não havia botão próprio de
  consulta nas Definições Android. A consulta nativa não desativava caches.
- Windows 1.5.1: electron/windows-updater.cjs consultava GitHub uma vez por
  abertura (6 s, 15 s em squirrel-firstrun), sem retentar automaticamente depois
  de erro nem consultar ao voltar do segundo plano. Falhas de rede/rate limit
  podiam deixar sem oferta até reiniciar ou consultar manualmente. O diálogo
  só aparecia depois de baixar e preparar o pacote inteiro. O filtro também
  aceitava prereleases numéricas, misturando canal de testes e estável.
- Windows usa Squirrel.Windows/Electron autoUpdater. Não substituir o instalador.
  Windows 1.4.7 ou anterior não possui esse atualizador. Instalações portable/
  desenvolvimento não possuem Update.exe e não são compatíveis. Precisam de
  instalação manual uma vez. Android tem o mecanismo desde 1.4.6/versionCode19;
  clientes anteriores precisam instalar APK manualmente. Versão instalada é lida
  do PackageManager Android e app.getVersion() Windows; não é texto do site.
- Há manifesto Android legado em /v1/app-releases/android (D1), enquanto Windows
  usava GitHub. Publicação podia ficar inconsistente entre plataformas. Não há
  evidência de incidente SSL ou hash incorreto em usuários: não atribuir os
  relatos a uma causa única sem seus registros, versão e rede.
- É normal a própria 1.5.1 não oferecer uma versão superior enquanto ela for a
  versão mais recente publicada. Um arquivo remoto não reescreve o cliente antigo.
- EXE estável 1.5.1 não tem assinatura Authenticode (Get-AuthenticodeSignature:
  NotSigned). Não declarar assinatura Windows validada. HTTPS do domínio oficial,
  URLs oficiais GitHub e SHA-256/SHA-1 asseguram a cadeia de distribuição prevista,
  não substituem um certificado Authenticode. Certificado próprio é dependência
  pendente para assinatura Windows. Não modificar o EXE 1.5.1 para adicioná-la.

## Correções na candidata

- Android: disparo independente da carga do perfil, deduplicado; verificação
  ao retornar/online, intervalo remoto limitado a 15–1440 min (padrão 60),
  repetição após falha; botão manual; erro visível nas Definições e uso offline
  preservado. Sem consulta a cada pacote de rádio ou escrita de presença.
- Ambas: versão atual/disponível, data e novidades; Atualizar agora, Mais tarde,
  lembrança na próxima abertura ou após política remota (padrão 24 h). Oferta
  adiada durante TX/RX, em segundo plano, outro diálogo ou edição de texto.
- Windows: anuncia antes de baixar; download somente por escolha explícita;
  consulta ao foco/retomada do sistema, retentativa de falha, preserva Squirrel,
  hashes, temporários, feed local com token e reinício assistido. Se Squirrel
  não confirmar a preparação, relata erro em vez de afirmar que já está atual.
  Depois de preparar, Squirrel pode aplicar no próximo início normal; não há
  downgrade automático nem promessa de rollback de todas as falhas de sistema.
- Android: HTTPS sem cache com User-Agent explícito; valida tamanho, SHA-256,
  packageId, versão, certificado igual ao instalado e minSdk. Download em worker,
  PackageInstaller normal/confirmado, sem Google Play nem instalação silenciosa.
  Uma rotação legítima de chave exigirá análise própria; não relaxar comparação.
- Nenhuma oferta instala ou prepara o rádio sozinha. Encerramento seguro recusa
  TX e, nesta candidata, também RX antes de substituir arquivos.

## Manifesto e publicação central

Preparado em site/public/updates/stable.json; contém SOMENTE a 1.5.1 já pública.
Campos por plataforma: versão/código quando aplicável, mínimo compatível,
publicação, canal, novidades, URL HTTPS, tamanho e SHA-256; Windows inclui EXE,
nupkg e RELEASES. Políticas no topo; crítica somente quando um mínimo necessário
com motivo objetivo for aprovado, nunca para forçar atualização cosmética.

Worker preparado para servir /updates/stable.json e adaptar a mesma fonte ao
endpoint Android legado ANTES de entrar na API/banco. Teste com DB inacessível
confirmou zero acesso D1 e Cache-Control no-store. Este backend ainda NÃO foi
implantado: a versão 1.5.1 e suas configurações de produção continuam intactas.

Os clientes novos usam domínio oficial; fallback apenas em HTTP404: Android ao
endpoint legado, Windows ao GitHub filtrando stable/draft/prerelease. Erros SSL,
503, JSON inválido ou assinatura/hash errado não relaxam confiança.

Após aprovação e testes reais: publicar todos os binários e fontes da versão
com tag numérica; conferir hashes/tamanhos; só então atualizar manifesto estável
por plataforma e implantar o Worker. É possível publicar versões diferentes para
Android e Windows. Não basta alterar tabela D1: painel legado está identificado
como registro e não como controle do novo feed estático. A tabela continua para
compatibilidade do servidor; consultas de atualização passam pela rota estática.
Não executar a publicação automaticamente nesta tarefa.

## WhatsApp oficial — preparado, não ativado

Já existem consentimento específico opcional, validação do número, cancelamento
PARAR/SAIR/STOP, supressão, dados cifrados e unicidade destinatário/versão na fila.
A ponte existente usa Baileys; não é a plataforma oficial Meta. A candidata
interrompe a descoberta/despacho de AVISOS DE VERSÃO por essa ponte. OTP e
cadastro existentes não foram modificados. Produção não foi implantada, portanto
essa alteração de transporte também permanece pendente de aprovação.

whatsapp-official.mjs prepara POST de template à Graph API. Sem configuração
retorna pending_configuration, não chama rede e não marca como enviado. Aceito
pela API não é entregue. Não houve mensagem real, disparo ou cadastro Meta.
Pendências: conta empresarial/WABA e número habilitados, token protegido,
versão Graph suportada, template aprovado e idioma/categoria corretos; conectar
fila ao adapter e implementar recibos/webhook com verificação de assinatura
antes de ativar a rotina. Não preencher tokens no chat nem no manifesto público.

Meta exige opt-in, respeitar cancelamento e templates aprovados para iniciar
conversas/fora da janela de atendimento. Categoria e país alteram o preço por
mensagem entregue; não presumir envio gratuito ou classificar o aviso como
utility sem aprovação. Fontes consultadas:
https://whatsappbusiness.com/policy/
https://whatsappbusiness.com/products/platform-pricing/
https://www.electronjs.org/docs/latest/api/auto-updater

## Testes e limites

Automatizados executados (harness local, sem rádio/rede/mensagem de usuários):
- scripts/validation/app-updater.test.cjs: Android offline/reconsulta, comparação
  e ausência de oferta quando atual, TX/segundo plano, Mais tarde sem repetição,
  URL/versão/canal inválido, aceite/download/preparação/instalador e retorno.
- scripts/validation/windows-updater152.test.cjs: consulta sem download automático,
  offline/recuperação, download corrompido recusado e repetição íntegra, preparação
  Squirrel simulada, recusa TX, entrega do reinício, arquivo pessoal preservado,
  comparação numérica (1.10 > 1.9), atual igual e canal de testes recusado.
- scripts/validation/update-feed152.test.mjs: endpoints estático e legado retornam
  1.5.1, D1 não acessado, cache no-store, WhatsApp sem configuração não envia.
- Compilação TypeScript/Android/Electron, assinatura e integridade dos pacotes;
  confronto da baseline 1.5.1 antes/depois e metadados públicos estáveis.

Pendentes, NÃO declarados realizados: instalação nova e atualização real sobre
1.5.1 em Android físico, comparação de certificados pelo instalador do aparelho,
permissão de fontes desconhecidas, instalação/reinício real Squirrel e recuperação
em falha do Windows, rede lenta/interrompida em aparelho, preservação real de
histórico e perfis em duas instalações, app encerrado/reaberto e chamadas reais.
adb devices não encontrou aparelhos conectados. Simular não substitui esses
casos. Nenhuma nova release deve ser publicada antes de validá-los e obter
aprovação do responsável. O verificador funciona com o app aberto/retomado; não
promete avisos com processo totalmente encerrado.
