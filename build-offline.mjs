import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = new URL('./dist/', import.meta.url);
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  throw new Error('Usage: node build-offline.mjs [--check]');
}
let html = await readFile(new URL('index.html', base), 'utf8');
const hashes = [];
for (const file of ['vendor/jszip.min.js', 'sample.js', 'engine.js', 'app.js']) {
  // HTML parsing normalizes line endings before CSP checks inline content.
  const code = (await readFile(new URL(file, base), 'utf8'))
    .replace(/\r\n?/g, '\n')
    .replace(/<\/script/gi, '<\\/script');
  hashes.push(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
  html = html.replace(`<script src="${file}" defer></script>`, () => `<script>${code}</script>`);
}
// Inline scripts execute after the interface exists, in their dependency order.
const scripts = [...html.matchAll(/<script>[\s\S]*?<\/script>/g)].map((m) => m[0]);
html = html
  .replace(/\s*<script>[\s\S]*?<\/script>/g, '')
  .replace('</body>', () => `${scripts.join('\n')}\n</body>`);
const css = (await readFile(new URL('styles.css', base), 'utf8')).replace(/\r\n?/g, '\n');
const styleHash = `'sha256-${createHash('sha256').update(css).digest('base64')}'`;
const stylesheet = /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/;
if (!stylesheet.test(html)) throw new Error('The authored stylesheet link could not be found.');
html = html.replace(stylesheet, () => `<style>${css}</style>`);
const logo = await readFile(new URL('assets/glorp-64.png', base));
html = html.replaceAll('assets/glorp-64.png', `data:image/png;base64,${logo.toString('base64')}`);
html = html
  .replace("script-src 'self'", () => `script-src 'self' ${hashes.join(' ')}`)
  .replace("style-src 'self'", () => `style-src 'self' ${styleHash}`);
html = html.replace(
  /href="index\.html"(\s+)aria-label="Emote Workshop home"/,
  'href="#"$1aria-label="Emote Workshop home"',
);
if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/i.test(html)) {
  throw new Error('The offline build still references an external script or stylesheet.');
}
const output = new URL('./Emote Workshop.html', import.meta.url);
if (check) {
  const existing = await readFile(output, 'utf8');
  if (existing.replace(/\r\n?/g, '\n') !== html.replace(/\r\n?/g, '\n')) {
    throw new Error('Emote Workshop.html is stale. Run npm run build and commit the rebuilt file.');
  }
  console.log('Emote Workshop.html matches the authored source.');
} else {
  await writeFile(output, html);
  console.log('Created Emote Workshop.html — self-contained, no installation or server required.');
}
