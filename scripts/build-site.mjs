import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url),
  output = new URL('dist/server/', root),
  types = {
    'index.html': 'text/html; charset=utf-8',
    'app.js': 'text/javascript; charset=utf-8',
    'engine.js': 'text/javascript; charset=utf-8',
    'sample.js': 'text/javascript; charset=utf-8',
    'vendor/jszip.min.js': 'text/javascript; charset=utf-8',
    'styles.css': 'text/css; charset=utf-8',
    'assets/glorp-64.png': 'image/png',
  },
  assets = {};
for (const [file, type] of Object.entries(types)) {
  assets[`/${file}`] = {
    type,
    body: (await readFile(new URL(`dist/${file}`, root))).toString('base64'),
  };
}
await mkdir(output, { recursive: true });
await writeFile(new URL('assets.mjs', output), `export default ${JSON.stringify(assets)};\n`);
await writeFile(
  new URL('twitter-import.mjs', output),
  await readFile(new URL('twitter-import.mjs', root)),
);
await writeFile(
  new URL('index.js', output),
  `${await readFile(new URL('site-worker.mjs', root), 'utf8')}\nimport assets from './assets.mjs';\nexport default createWorkshopWorker({ assets });\n`,
);
await writeFile(new URL('package.json', output), '{"type":"module"}\n');
console.log('Built the hosted editor and public Twitter/X resolver.');
