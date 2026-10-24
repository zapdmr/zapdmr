(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZapDMRTalkgroups = api;
})(typeof window === 'object' ? window : globalThis, function () {
  function recent(activity, now = Date.now()) {
    const at = Number(activity?.lastActivityAt ?? activity);
    const age = now - at;
    return Number.isFinite(at) && at > 0 && age >= 0 &&
      (age < 60000 || (activity?.active === true && age < 180000));
  }
  function live(activity, now = Date.now()) { return activity?.active === true && recent(activity, now); }
  function filter(groups, { category = 'all', query = '', status = 'all', activity = {}, now = Date.now() } = {}) {
    const text = query.trim().toLocaleLowerCase('pt-BR');
    return groups.filter((group) => {
      if (category !== 'all' && group.category !== category) return false;
      if (text && ![group.id, group.name, group.region || ''].some((value) => String(value).toLocaleLowerCase('pt-BR').includes(text))) return false;
      const active = recent(activity[String(group.id)], now);
      return status === 'all' || (status === 'active' ? active : !active);
    });
  }
  function scanTarget(groups, activity, selectedId, selectedSince, now = Date.now(), holdMs = 4000) {
    const active = groups.filter((group) => group.id !== 4000 && recent(activity[String(group.id)], now));
    if (!active.length) return undefined;
    const current = active.find((group) => group.id === Number(selectedId));
    if (current && (live(activity[String(current.id)], now) || now - Math.max(selectedSince,Number(activity[String(current.id)]?.lastActivityAt)||0) < holdMs)) return current;
    const onAir = active.filter((group) => live(activity[String(group.id)], now));
    if (onAir.length) return onAir.sort((a, b) => Number(activity[String(b.id)]?.lastActivityAt || 0) - Number(activity[String(a.id)]?.lastActivityAt || 0))[0];
    active.sort((a, b) => a.id - b.id);
    const index = active.findIndex((group) => group.id === Number(selectedId));
    return active[(index + 1) % active.length];
  }
  return { recent, live, filter, scanTarget };
});
