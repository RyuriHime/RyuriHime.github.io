#!/usr/bin/env node
// Runs after `hexo generate`. Full-resolution wallpaper derivatives are never
// published: only the shuffled byte fragments in `source/assets/wallpaper/`
// are. Remove the private folder from `public/` on every build and fail if any
// HTML still references it.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const privateDir = path.join(publicDir, 'assets', 'private');

fs.rmSync(privateDir, { recursive: true, force: true });

if (!fs.existsSync(publicDir)) process.exit(0);

// Belt and braces: no public HTML may reference the private stylesheet.
const offenders = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) {
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes('private-assets.css') || text.includes('/assets/private/')) {
        offenders.push(path.relative(root, full));
      }
    }
  }
}
walk(publicDir);

if (offenders.length) {
  console.error('[prune-private] public HTML still references private assets:');
  offenders.forEach((file) => console.error('  ' + file));
  process.exit(1);
}

console.log('[prune-private] public build contains no full-size wallpaper assets');
