'use strict';

// Protect TeX before Markdown runs.
//
// hexo-renderer-marked applies CommonMark backslash escapes and HTML-escapes
// text it re-parses, so `\[ ... \]` loses its delimiters, `\\` row breaks
// collapse, and a quote inside inline math turns into `&#39;`. Existing posts
// are also written in a "doubled" style (`\\( ... \\)`) because that is what
// Markdown traditionally needs.
//
// The fix: replace every math region with an empty <script> carrying a Base64
// payload. Base64 survives Markdown untouched, so no character in the TeX can
// be escaped. after_post_render decodes the payload back into raw TeX, and the
// theme's MathJax partial turns those nodes into $...$ / $$...$$ text.
const CODE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

function halveBackslashes(text) {
  return text.replace(/\\+/g, (run) => {
    if (run.length === 1) return run;
    return '\\'.repeat(Math.max(1, Math.floor(run.length / 2)));
  });
}

function toScript(body, display) {
  const payload = Buffer.from(String(body), 'utf8').toString('base64');
  const type = display ? 'math/tex; mode=display' : 'math/tex';
  return `<script type="${type}" data-hexo-tex="${payload}"></script>`;
}

function transformChunk(chunk) {
  return chunk
    .replace(/\$\$([\s\S]+?)\$\$/g, (match, body) => toScript(body.trim(), true))
    .replace(/\\\\\[([\s\S]+?)\\\\\]/g, (match, body) => toScript(halveBackslashes(body).trim(), true))
    .replace(/\\\\\(([\s\S]+?)\\\\\)/g, (match, body) => toScript(halveBackslashes(body).trim(), false))
    .replace(/\\\[([\s\S]+?)\\\]/g, (match, body) => toScript(body.trim(), true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (match, body) => toScript(body.trim(), false))
    // Only touch $...$ when it holds a backslash-escaped punctuation such as
    // \\{ or \\, ; plain math like $O(n \\log n)$ is left to MathJax.
    .replace(/\$(?!\$)([^$\n]*\\[^A-Za-z$\n][^$\n]*?)\$(?!\$)/g, (match, body) => toScript(body.trim(), false));
}

function protectMath(content) {
  const parts = String(content).split(CODE_SPLIT);
  return parts
    .map((part, index) => (index % 2 ? part : transformChunk(part)))
    .join('');
}

function decodeScripts(html) {
  return String(html).replace(
    /<script type="math\/tex(; mode=display)?" data-hexo-tex="([A-Za-z0-9+/=]+)">\s*<\/script>/g,
    (match, display, payload) => {
      const tex = Buffer.from(payload, 'base64')
        .toString('utf8')
        .replace(/<\/script/gi, '<\\/script');
      return `<script type="math/tex${display || ''}">${tex}</script>`;
    }
  );
}

hexo.extend.filter.register('before_post_render', function (data) {
  if (typeof data.content !== 'string') return data;
  if (!data.content.includes('$') && !data.content.includes('\\')) return data;
  data.content = protectMath(data.content);
  return data;
}, 5);

hexo.extend.filter.register('after_post_render', function (data) {
  if (typeof data.content === 'string') data.content = decodeScripts(data.content);
  if (typeof data.excerpt === 'string') data.excerpt = decodeScripts(data.excerpt);
  return data;
}, 5);
