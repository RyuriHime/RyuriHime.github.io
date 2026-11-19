// Build the About page from source/_data/profile.yml so the writing desk can
// edit it as a normal form instead of hand-editing HTML.
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function paragraphs(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${esc(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n      ');
}

function linkAnchor(item, extraClass, role) {
  const label = esc(item.label || '链接');
  const url = String(item.url || '').trim();
  const icon = String(item.icon || '').replace(/[^a-z0-9 -]/gi, '');
  if (!url) return '';
  const external = /^https?:/i.test(url);
  const attrs = external ? ' target="_blank" rel="noopener"' : '';
  const cls = extraClass ? ` class="${extraClass}"` : '';
  const roleAttr = role ? ` role="${role}"` : '';
  const iconTag = icon ? `<i class="${icon}" aria-hidden="true"></i>` : '';
  return `<a${cls} href="${esc(url)}"${attrs}${roleAttr}>${iconTag}<span>${label}</span></a>`;
}

function linkItem(item) {
  const url = String(item.url || '').trim();
  if (!url) return '';
  const children = (Array.isArray(item.menu) ? item.menu : [])
    .map((child) => linkAnchor(child, '', 'menuitem'))
    .filter(Boolean);
  if (!children.length) return linkAnchor(item);

  const icon = String(item.icon || '').replace(/[^a-z0-9 -]/gi, '');
  const external = /^https?:/i.test(url);
  const attrs = external ? ' target="_blank" rel="noopener"' : '';
  const iconTag = icon ? `<i class="${icon}" aria-hidden="true"></i>` : '';
  const label = esc(item.label || '链接');
  const current = linkAnchor({ ...item, label: `${item.label || '链接'}（现在）` }, 'is-current', 'menuitem');
  return [
    '<div class="profile-link-wrap has-menu">',
    `  <a class="profile-link-main" href="${esc(url)}"${attrs} aria-haspopup="true" aria-expanded="false">${iconTag}<span>${label}</span><i class="fas fa-angle-down profile-link-caret" aria-hidden="true"></i></a>`,
    '  <div class="profile-submenu" role="menu">',
    `    ${current}`,
    `    ${children.join('\n    ')}`,
    '  </div>',
    '</div>',
  ].join('\n');
}

hexo.extend.generator.register('about-profile', function () {
  const data = (hexo.locals.get('data') || {}).profile;
  if (!data) return [];

  const name = String(data.name || 'RyuriHime');
  const pageTitle = String(data.title || '关于');
  const tagline = String(data.tagline || '');
  const avatar = String(data.avatar || '/images/avatar.webp');
  const bio = paragraphs(data.bio);
  const links = (Array.isArray(data.contacts) ? data.contacts : [])
    .map(linkItem)
    .filter(Boolean)
    .join('\n      ');

  const content = [
    '<div class="profile-page">',
    '  <div class="profile-head">',
    `    <img class="profile-avatar" src="${esc(avatar)}" alt="${esc(name)}" width="112" height="112" loading="eager">`,
    `    <h2 class="profile-name">${esc(name)}</h2>`,
    tagline ? `    <p class="profile-tagline">${esc(tagline)}</p>` : '',
    '  </div>',
    bio ? `  <div class="profile-bio">\n      ${bio}\n  </div>` : '',
    links ? `  <nav class="profile-links" aria-label="联系方式">\n      ${links}\n  </nav>` : '',
    '</div>',
  ].filter(Boolean).join('\n');

  return [{
    path: 'about/index.html',
    layout: ['page'],
    data: {
      title: pageTitle,
      type: 'page',
      top_img: '/images/banner.svg',
      comments: false,
      aside: false,
      content,
    },
  }];
});
