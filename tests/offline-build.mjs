import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = path.join(tmpdir(), 'emote-workshop-build-test-');
const fixture = await mkdtemp(prefix);
const run = (...args) =>
  spawnSync(process.execPath, ['build-offline.mjs', ...args], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 10000,
  });
try {
  const files = [
    'build-offline.mjs',
    'Emote Workshop.html',
    'dist/index.html',
    'dist/styles.css',
    'dist/app.js',
    'dist/engine.js',
    'dist/sample.js',
    'dist/vendor/jszip.min.js',
    'dist/assets/glorp-64.png',
  ];
  for (const file of files) {
    const target = path.join(fixture, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file), target);
  }
  const output = path.join(fixture, 'Emote Workshop.html');
  const original = await readFile(output, 'utf8');
  const clean = run('--check');
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(await readFile(output, 'utf8'), original, '--check must be read-only');
  const stale = `${original}\n<!-- stale test fixture -->`;
  await writeFile(output, stale);
  const rejected = run('--check');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /is stale/);
  assert.equal(await readFile(output, 'utf8'), stale, '--check must not overwrite stale files');
  const rebuilt = run();
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  const html = await readFile(output, 'utf8');
  assert.equal(html.replace(/\r\n?/g, '\n'), original.replace(/\r\n?/g, '\n'));
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/i);
  assert.match(html, /href="#"\s+aria-label="Emote Workshop home"/);
  assert.equal(run('--check').status, 0);
  console.log('Offline packaging, deterministic rebuild, and read-only freshness checks OK');
} finally {
  // Only remove the unique fixture created by this test, never the workspace.
  if (!path.resolve(fixture).startsWith(path.resolve(prefix))) {
    throw new Error('Unexpected temporary fixture path');
  }
  await rm(fixture, { recursive: true, force: true });
}
