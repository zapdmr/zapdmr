(function (root) {
  const bundled = [
  {"id":724,"slot":1,"name":"Brasil Nacional","category":"Nacionais e mundiais","kind":"group","note":"Todas as repetidoras nacionais."},
  {"id":724942,"slot":2,"name":"Net-BR","category":"Nacionais e mundiais","kind":"group","note":"Agenda às terças-feiras, 20:00 UTC."},
  {"id":905,"slot":2,"name":"Net-OM Português","category":"Nacionais e mundiais","kind":"group","note":"Agenda às quartas-feiras, 22:00 UTC."},
  {"id":91,"slot":2,"name":"World Wide NET","category":"Nacionais e mundiais","kind":"group","note":"Agenda aos sábados, 16:00 UTC."},
  {"id":8,"slot":2,"name":"Cluster / Regional","category":"Nacionais e mundiais","kind":"group","note":"Grupos de repetidoras."},
  {"id":2,"slot":2,"name":"Local","category":"Nacionais e mundiais","kind":"group","note":"Condata Local."},
  {"id":7241,"slot":2,"name":"Região Norte","category":"Regiões","region":"Norte","kind":"group"},
  {"id":7242,"slot":2,"name":"Região Nordeste","category":"Regiões","region":"Nordeste","kind":"group"},
  {"id":7243,"slot":2,"name":"Região Centro-Oeste","category":"Regiões","region":"Centro-Oeste","kind":"group"},
  {"id":7244,"slot":2,"name":"Região Sudeste","category":"Regiões","region":"Sudeste","kind":"group"},
  {"id":7245,"slot":2,"name":"Região Sul","category":"Regiões","region":"Sul","kind":"group"},
  {"id":72411,"slot":2,"name":"Acre","category":"Estados","region":"Norte","kind":"group"},
  {"id":72412,"slot":2,"name":"Amapá","category":"Estados","region":"Norte","kind":"group"},
  {"id":72413,"slot":2,"name":"Amazonas","category":"Estados","region":"Norte","kind":"group"},
  {"id":72414,"slot":2,"name":"Pará","category":"Estados","region":"Norte","kind":"group"},
  {"id":72415,"slot":2,"name":"Rondônia","category":"Estados","region":"Norte","kind":"group"},
  {"id":72416,"slot":2,"name":"Roraima","category":"Estados","region":"Norte","kind":"group"},
  {"id":72417,"slot":2,"name":"Tocantins","category":"Estados","region":"Norte","kind":"group"},
  {"id":72421,"slot":2,"name":"Alagoas","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72422,"slot":2,"name":"Bahia","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72423,"slot":2,"name":"Ceará","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72424,"slot":2,"name":"Maranhão","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72425,"slot":2,"name":"Paraíba","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72426,"slot":2,"name":"Pernambuco","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72427,"slot":2,"name":"Piauí","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72428,"slot":2,"name":"Rio Grande do Norte","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72429,"slot":2,"name":"Sergipe","category":"Estados","region":"Nordeste","kind":"group"},
  {"id":72431,"slot":2,"name":"Distrito Federal","category":"Estados","region":"Centro-Oeste","kind":"group"},
  {"id":72432,"slot":2,"name":"Goiás","category":"Estados","region":"Centro-Oeste","kind":"group"},
  {"id":72433,"slot":2,"name":"Mato Grosso","category":"Estados","region":"Centro-Oeste","kind":"group"},
  {"id":72434,"slot":2,"name":"Mato Grosso do Sul","category":"Estados","region":"Centro-Oeste","kind":"group"},
  {"id":72441,"slot":2,"name":"Espírito Santo","category":"Estados","region":"Sudeste","kind":"group"},
  {"id":72442,"slot":2,"name":"Minas Gerais","category":"Estados","region":"Sudeste","kind":"group"},
  {"id":72443,"slot":2,"name":"Rio de Janeiro","category":"Estados","region":"Sudeste","kind":"group"},
  {"id":72444,"slot":2,"name":"São Paulo","category":"Estados","region":"Sudeste","kind":"group"},
  {"id":72451,"slot":2,"name":"Paraná","category":"Estados","region":"Sul","kind":"group"},
  {"id":72452,"slot":2,"name":"Rio Grande do Sul","category":"Estados","region":"Sul","kind":"group"},
  {"id":72453,"slot":2,"name":"Santa Catarina","category":"Estados","region":"Sul","kind":"group"},
  {"id":724943,"slot":2,"name":"XLX 724 D","category":"Redes externas","kind":"group","note":"Cross-linked BLR-D-0 ou BM via YSF 724."},
  {"id":724947,"slot":2,"name":"YM 724","category":"Redes externas","kind":"group","note":"Cross-linked BLR-D-0 ou BM via YSF 724."},
  {"id":724262,"slot":null,"name":"XLX 722","category":"Redes externas","kind":"group","note":"Cross-link TG 722 → XLX 722 (Argentina). Slot não indicado no PDF."},
  {"id":724997,"slot":null,"name":"Parrot","category":"Especiais","kind":"private","note":"Chamada privada: devolve o áudio para teste."},
  {"id":724999,"slot":null,"name":"ARS / RMS / GPS","category":"Especiais","kind":"private","note":"Chamada privada; uso em configurações APRS."},
  {"id":4000,"slot":null,"name":"Disconnect","category":"Especiais","kind":"command","note":"Comando para desligar TG dinâmico. Slot não indicado no PDF."}
];
  function normalize(input) {
    const rows = Array.isArray(input) ? input : input?.talkgroups || input?.groups || [];
    const result = new Map();
    for (const value of rows) {
      const id = Number(value?.id ?? value?.talkgroupId);
      if (!Number.isInteger(id) || id < 1 || id > 0xffffff) continue;
      result.set(id, { ...value, id, slot: Number(value.slot) === 2 ? 2 : 1,
        name: String(value.name || `TG ${id}`), category: String(value.category || 'Especiais') });
    }
    return [...result.values()];
  }
  root.ZapDMRCatalog = {
    normalize,
    merge(...lists) { return normalize(lists.flatMap((list) => normalize(list))); },
    bundled: normalize(bundled)
  };
})(window);
