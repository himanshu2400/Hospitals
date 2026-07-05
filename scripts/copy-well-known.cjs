// Postbuild safety net: explicitly copy public/.well-known into dist/.
// Vite already copies dotfolders from public/, but some deploy pipelines
// strip dotfiles. This guarantees .well-known/assetlinks.json lands in dist.
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'public', '.well-known');
const dest = path.resolve(__dirname, '..', 'dist', '.well-known');

if (!fs.existsSync(src)) {
  console.error('postbuild: public/.well-known not found');
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  console.log('postbuild: copied', file, '->', path.join(dest, file));
}
