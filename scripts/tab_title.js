// The site name shown on the page ("RyuriHime") and the browser tab title
// ("RyuriHime 的个人站") are separate. `tab_title` in _config.yml drives the
// <title> tag; `title` keeps driving the homepage hero and navigation brand.
hexo.extend.filter.register('after_render:html', function (str) {
  const site = String(hexo.config.title || '');
  const tab = String(hexo.config.tab_title || site);
  if (!site || !tab || tab === site) return str;

  return str.replace(/<title>([\s\S]*?)<\/title>/, (match, inner) => {
    const current = inner.trim();
    if (current === site) return `<title>${tab}</title>`;
    const suffix = ` | ${site}`;
    if (current.endsWith(suffix)) {
      return `<title>${current.slice(0, -suffix.length)} | ${tab}</title>`;
    }
    return match;
  });
});
