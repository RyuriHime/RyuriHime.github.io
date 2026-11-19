// Keep local-search snippets and the Atom feed readable.
// Both routes are generated in memory, so the cleanup must happen before they
// are written to disk. Math is wrapped in <script type="math/tex"> by
// scripts/math_protect.js; search drops it, the feed turns it back into
// delimiters so feed readers still show the TeX source.
function cleanSearchXml(text) {
  return text
    .replace(/<figure class="highlight[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/<script type="math\/tex; mode=display">[\s\S]*?<\/script>/gi, ' ')
    .replace(/<script type="math\/tex">[\s\S]*?<\/script>/gi, ' ')
    .replace(/<p>\s*\[[\s\S]*?<br>\]\s*<\/p>/gi, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]{1,240}?\$/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function cleanFeed(text) {
  return text
    .replace(/<script type="math\/tex; mode=display">([\s\S]*?)<\/script>/gi, (match, body) => `\\[${body}\\]`)
    .replace(/<script type="math\/tex">([\s\S]*?)<\/script>/gi, (match, body) => `\\(${body}\\)`);
}

function rewriteRoute(name, transform) {
  const route = hexo.route.get(name);
  if (!route) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const chunks = [];
    route.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    route.on('error', reject);
    route.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      hexo.route.set(name, transform(text));
      resolve();
    });
  });
}

hexo.extend.filter.register('after_generate', function () {
  return Promise.all([
    rewriteRoute('search.xml', cleanSearchXml),
    rewriteRoute('atom.xml', cleanFeed),
  ]);
});
