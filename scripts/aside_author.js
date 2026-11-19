// Butterfly falls back to `config.description` when the sidebar signature is
// empty. The writing desk promises "leave blank to hide", so drop the element
// entirely in that case instead of showing the site description.
hexo.extend.filter.register('after_render:html', function (str) {
  const author = ((hexo.theme.config.aside || {}).card_author) || {};
  if (String(author.description || '').trim()) return str;
  return str.replace(/<div class="author-info-description">[\s\S]*?<\/div>/, '');
});
