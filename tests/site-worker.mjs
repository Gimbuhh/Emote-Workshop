import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createWorkshopWorker } from '../site-worker.mjs';

const mediaUrl = 'https://video.twimg.com/tweet_video/example.mp4',
  requested = [],
  fetchImpl = async (url, options) => {
    requested.push({ url, options });
    return Response.json(
      new URL(url).searchParams.get('id') === '2'
        ? {}
        : { video: { variants: [{ type: 'video/mp4', src: mediaUrl }] } },
    );
  },
  worker = createWorkshopWorker({ fetchImpl }),
  endpoint = 'https://emotes.gimba.uk/api/twitter?id=123',
  headers = { Origin: 'null', 'X-Emote-Workshop-Import': 'twitter' };
const preflight = await worker.fetch(
  new Request(endpoint, {
    method: 'OPTIONS',
    headers: {
      Origin: 'null',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-emote-workshop-import',
    },
  }),
);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
assert.match(preflight.headers.get('access-control-allow-headers'), /X-Emote-Workshop-Import/);
assert.equal(requested.length, 0);
const response = await worker.fetch(new Request(endpoint, { headers }));
assert.equal(response.status, 200);
assert.equal(response.headers.get('access-control-allow-origin'), '*');
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.deepEqual(await response.json(), { mediaUrl });
assert.equal(new URL(requested[0].url).hostname, 'cdn.syndication.twimg.com');
assert.equal(requested[0].options.credentials, 'omit');
const beforeBlocked = requested.length;
for (const [url, options, status] of [
  [endpoint, {}, 403],
  [endpoint, { method: 'POST', headers }, 405],
  ['https://emotes.gimba.uk/api/twitter?id=https://localhost', { headers }, 400],
  [`${endpoint}&media=0`, { headers }, 400],
]) {
  const rejected = await worker.fetch(new Request(url, options));
  assert.equal(rejected.status, status);
  assert.equal(rejected.headers.get('access-control-allow-origin'), '*');
}
assert.equal(requested.length, beforeBlocked);
const unavailable = await worker.fetch(
  new Request('https://emotes.gimba.uk/api/twitter?id=2', { headers }),
);
assert.equal(unavailable.status, 502);
assert.match((await unavailable.json()).error, /No downloadable/);
const slow = createWorkshopWorker({
  timeoutMs: 10,
  fetchImpl: (_, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    ),
});
// Keep the test process alive while AbortSignal.timeout's unref'ed timer fires.
const keeper = setTimeout(() => {}, 1000);
try {
  const timedOut = await slow.fetch(new Request(endpoint, { headers }));
  assert.equal(timedOut.status, 502);
  assert.match((await timedOut.json()).error, /too long/);
} finally {
  clearTimeout(keeper);
}

const build = spawnSync(process.execPath, ['scripts/build-site.mjs'], { encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr);
const { default: built } = await import('../dist/server/index.js');
for (const [path, source, type] of [
  ['/', 'dist/index.html', 'text/html'],
  ['/app.js', 'dist/app.js', 'text/javascript'],
  ['/assets/glorp-64.png', 'dist/assets/glorp-64.png', 'image/png'],
]) {
  const asset = await built.fetch(new Request(`https://emotes.gimba.uk${path}`));
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), new RegExp(type));
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), await readFile(source));
}
assert.equal((await built.fetch(new Request('https://emotes.gimba.uk/missing'))).status, 404);
assert.equal(
  (await built.fetch(new Request('https://emotes.gimba.uk/', { method: 'HEAD' }))).body,
  null,
);
console.log(
  'Hosted resolver CORS, request guards, errors, timeout, and built editor assets passed',
);
