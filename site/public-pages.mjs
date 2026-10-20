const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const pages = {
  '/privacidade/': {
    title: 'Privacidade e escolha do operador',
    description: 'Como o ZapDMR utiliza o cadastro, protege o número e permite controlar a partilha de contactos.',
    sections: [
      ['Dados do cadastro', 'Recolhemos indicativo, DMR ID, WhatsApp com DDI e DDD, plataforma escolhida, data do cadastro e versão do aviso aceite. O número e a sua confirmação são obrigatórios para liberar o download pelo portal e ativar a conta da comunidade. A autorização para o mostrar a outros operadores é opcional, separada e desativada por padrão.'],
      ['Diretório e confirmação', 'Somente contas com número confirmado por código entram no diretório. A pesquisa exige autenticação e um indicativo ou DMR ID exato. Não existe uma lista pública de telefones. A confirmação demonstra acesso ao número informado; não comprova licença de radioamador ou titularidade do indicativo.'],
      ['Conversas e serviços externos', 'O ZapChat guarda mensagens e anexos cifrados no banco do servidor. Os anexos incluem nome, tipo, tamanho e conteúdo, visíveis aos participantes autenticados da conversa. O responsável mantém as chaves: não é cifragem ponta a ponta. O botão Chamar no Zap abre o WhatsApp oficial, sujeito à política desse serviço. As mensagens e posições APRS são públicas na rede APRS. O rádio DMR utiliza o master configurado no aplicativo.'],
      ['Conservação dos dados', 'Cadastros que não correspondam a uma conta confirmada são eliminados após 30 dias. As sessões expiram após 30 dias. Contas confirmadas permanecem até pedido de eliminação. O histórico ZapChat, incluindo anexos, permanece associado às contas e é eliminado quando uma das contas participantes é eliminada. Uploads abandonados são removidos após uma hora na limpeza periódica. O armazenamento gratuito tem limites de capacidade. As cópias de segurança seguem o procedimento de retenção do responsável.'],
      ['As suas escolhas', 'No perfil da comunidade do aplicativo é possível revogar a partilha do WhatsApp, bloquear contactos e eliminar a conta e as mensagens associadas. Pode contactar o responsável para solicitar acesso, correção ou outros esclarecimentos sobre os seus dados. Avisos de novas versões por WhatsApp são opcionais e exigem uma autorização separada. Guardamos essa escolha, sua data e a versão do aviso. Somente números confirmados que solicitaram um instalador podem receber avisos futuros. Para cancelar, responda PARAR, STOP ou SAIR ao WhatsApp oficial. O cancelamento não bloqueia códigos de acesso nem o ZapChat. Não usamos o cadastro para publicidade de terceiros.'],
      ['Entrega de códigos e operação', 'Conforme a configuração, um serviço envia o código ao seu número ou recebe uma mensagem de confirmação enviada por você pelo WhatsApp. No segundo caso, visualizar o código ou abrir o WhatsApp não basta: o serviço precisa confirmar a mensagem recebida do número cadastrado. O provedor depende da configuração da hospedagem. A sessão do portal fica somente na memória da aba, sem token em cookies, armazenamento local ou URL. Dados técnicos mínimos, como endereço de rede e horário, podem ser utilizados para limitar abuso e operar o serviço. Não há rastreadores publicitários neste portal.']
    ]
  },
  '/termos/': {
    title: 'Termos da edição beta',
    description: 'Condições de utilização do ZapDMR, da comunidade e dos downloads da edição beta.',
    sections: [
      ['Operação de rádio', 'O ZapDMR destina-se a radioamadores licenciados, com indicativo e DMR ID próprios e acesso autorizado ao servidor mestre. Cada operador é responsável pelas regras da rede e pelas condições da sua licença. O aplicativo não é um serviço de emergência.'],
      ['Edição beta e código', 'A edição 1.4 é de avaliação. Áudio, acessórios, GPS, voz individual e ligação dependem do equipamento e de serviços externos. O scan HBP percorre uma TG de cada vez. O código-fonte correspondente é disponibilizado sob GPL-3.0; componentes e firmware conservam os respetivos avisos.'],
      ['Cadastro e contactos', 'O WhatsApp com DDI e DDD é obrigatório no cadastro. A partilha com outros operadores depende de autorização separada do titular. O código confirma acesso ao número; não certifica a licença ou o indicativo. Não é permitido recolher números em massa, assediar operadores ou utilizar o diretório para mensagens não solicitadas.'],
      ['WhatsApp, ZapChat e APRS', 'ZapChat é a conversa própria da comunidade. O botão Chamar no Zap abre o WhatsApp oficial para que o operador conclua o envio por lá. O ZapDMR não lê nem incorpora conversas privadas de contas WhatsApp. Mensagens APRS e posições publicadas nessa rede são públicas.'],
      ['Disponibilidade e eliminação', 'O download pelo portal é liberado após confirmar o WhatsApp, quando o instalador real estiver publicado. A confirmação de novos números depende de um serviço de envio ou recepção de mensagens configurado pelo administrador. Os arquivos publicados em uma Release pública do GitHub também podem ser acessados diretamente, e o código-fonte GPL permanece público sem cadastro. É possível bloquear contactos, revogar a partilha do número e eliminar a conta no aplicativo.']
    ]
  }
};

export const publicPagePaths = ['/', ...Object.keys(pages)];

export function renderPublicPage(template, pathname, { origin, owner, privacyEmail, production, assetsVersion }) {
  if (!publicPagePaths.includes(pathname)) return null;
  const configured = Boolean(owner && privacyEmail);
  const contact = configured
    ? `${escapeHtml(owner)} · Privacidade: <a href="mailto:${escapeHtml(privacyEmail)}">${escapeHtml(privacyEmail)}</a>`
    : owner ? `${escapeHtml(owner)} · Prévia: contacto de privacidade pendente de configuração.`
    : 'Prévia local · responsável e contacto de privacidade pendentes de configuração.';
  let html = template.replace(/(<small id="siteOwner">)[\s\S]*?(<\/small>)/, (_, start, end) => start + contact + end);
  if (assetsVersion) html = html.replace('href="/site.css"', `href="/site.css?v=${escapeHtml(assetsVersion)}"`).replace('src="/site.js"', `src="/site.js?v=${escapeHtml(assetsVersion)}"`);
  const page = pages[pathname];
  if (page) {
    const sections = page.sections.map(([title, paragraph]) =>
      `<section><h2>${escapeHtml(title)}</h2><p>${escapeHtml(paragraph)}</p></section>`).join('');
    const content = `<main id="conteudo"><article class="wrap legal"><p class="eyebrow">COMUNIDADE ZAPDMR · 19 DE OUTUBRO DE 2026</p><h1>${escapeHtml(page.title)}</h1><p>${contact}</p>${sections}<p><a class="text-link" href="/#downloads">Voltar aos downloads ↗</a></p></article></main>`;
    html = html.replace(/<main id="conteudo">[\s\S]*?<\/main>/, () => content)
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(page.title)} · ZapDMR</title>`)
      .replace(/(<meta name="description" content=")[^"]*(">)/, (_, start, end) => start + escapeHtml(page.description) + end)
      .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_, start, end) => start + escapeHtml(page.title + ' · ZapDMR') + end)
      .replace(/(<meta property="og:description" content=")[^"]*(">)/, (_, start, end) => start + escapeHtml(page.description) + end);
  }
  const canonical = escapeHtml(new URL(pathname, origin).href);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(">)/, (_, start, end) => start + canonical + end)
    .replace(/(<meta property="og:url" content=")[^"]*(">)/, (_, start, end) => start + canonical + end);
  if (!production) html = html.replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>');
  return html;
}

export function sitemap(origin) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPagePaths.map(pathname => `<url><loc>${escapeHtml(new URL(pathname, origin).href)}</loc></url>`).join('')}</urlset>`;
}
