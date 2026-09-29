import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { selectTwitterMedia, resolveTwitterMedia } from '../twitter-import.mjs';
import { createWorkshopServer } from '../serve.mjs';

const gif = 'https://video.twimg.com/tweet_video/example.mp4',
  low = 'https://video.twimg.com/ext_tw_video/123/vid/320x180/low.mp4',
  high = 'https://video.twimg.com/ext_tw_video/123/vid/1280x720/high.mp4?tag=1',
  fixture = {
    mediaDetails: [
      { type: 'photo' },
      {
        type: 'video',
        video_info: {
          variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' },
            { content_type: 'video/mp4', bitrate: 256000, url: low },
            { content_type: 'video/mp4', bitrate: 2176000, url: high },
            { content_type: 'video/mp4', bitrate: 9999999, url: 'https://example.com/file.mp4' },
          ],
        },
      },
      { type: 'animated_gif', video_info: { variants: [{ content_type: 'video/mp4', url: gif }] } },
    ],
  };
assert.equal(selectTwitterMedia(fixture), gif);
assert.equal(selectTwitterMedia(fixture, '2'), high);
assert.equal(selectTwitterMedia({ mediaDetails: [null, ...fixture.mediaDetails] }), gif);
assert.equal(
  selectTwitterMedia({
    mediaDetails: [
      {
        type: 'video',
        video_info: {
          variants: [null, {}, { content_type: 'video/mp4', url: high }],
        },
      },
    ],
  }),
  high,
);
assert.equal(selectTwitterMedia({ mediaDetails: fixture.mediaDetails.slice(0, 2) }), high);
assert.equal(
  selectTwitterMedia({
    video: {
      variants: [
        { type: 'video/mp4', src: low },
        { type: 'video/mp4', src: high },
      ],
    },
  }),
  high,
);
for (const tweet of [{}, null, { __typename: 'TweetTombstone' }, { mediaDetails: 'invalid' }]) {
  assert.throws(() => selectTwitterMedia(tweet), /No downloadable/);
}
for (const index of ['1', '4'])
  assert.throws(() => selectTwitterMedia(fixture, index), /No downloadable/);
for (const value of [
  'http://video.twimg.com/tweet_video/x.mp4',
  'https://video.twimg.com.evil.test/tweet_video/x.mp4',
  'https://user:password@video.twimg.com/tweet_video/x.mp4',
  'https://video.twimg.com:8080/tweet_video/x.mp4',
  'https://video.twimg.com/tweet_video/x.m3u8',
  'https://127.0.0.1/file.mp4',
])
  assert.throws(
    () => selectTwitterMedia({ video: { variants: [{ type: 'video/mp4', src: value }] } }),
    /No downloadable/,
    value,
  );
assert.equal(
  selectTwitterMedia({ video: { variants: [{ type: 'video/mp4', src: `${gif}#fragment` }] } }),
  gif,
);

const requested = [],
  fetchImpl = async (url, options) => {
    requested.push({ url, options });
    const id = new URL(url).searchParams.get('id');
    if (id === '4') return new Response('not found', { status: 404 });
    if (id === '5') return new Response('not JSON');
    if (id === '6')
      return new Response('{}', { headers: { 'Content-Length': String(3 * 1024 * 1024) } });
    if (id === '7') return new Response(' '.repeat(2 * 1024 * 1024 + 1));
    if (id === '8')
      return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/' } });
    return Response.json(id === '3' ? {} : fixture);
  };
assert.equal((await resolveTwitterMedia('123', '', { fetchImpl })).mediaUrl, gif);
assert.equal((await resolveTwitterMedia('123', '2', { fetchImpl })).mediaUrl, high);
// Exercise the resolver in a web-only context: no Node globals or imports.
const portable = { URL, URLSearchParams, Blob },
  resolverSource = await readFile(new URL('../twitter-import.mjs', import.meta.url), 'utf8');
vm.runInNewContext(
  `${resolverSource.replace(/^export /gm, '')}\nglobalThis.resolve = resolveTwitterMedia;`,
  portable,
);
assert.equal((await portable.resolve('123', '2', { fetchImpl })).mediaUrl, high);
assert.equal(new URL(requested[0].url).hostname, 'cdn.syndication.twimg.com');
assert(new URL(requested[0].url).searchParams.get('token'));
assert.equal(requested[0].options.redirect, 'manual');
assert.equal(requested[0].options.credentials, 'omit');
const beforeInvalid = requested.length;
for (const id of ['0', '', '../123', 'https://localhost/', '1'.repeat(21)]) {
  await assert.rejects(resolveTwitterMedia(id, '', { fetchImpl }), /Invalid/);
}
await assert.rejects(resolveTwitterMedia('123', '0', { fetchImpl }), /Invalid/);
assert.equal(requested.length, beforeInvalid);
await assert.rejects(resolveTwitterMedia('3', '', { fetchImpl }), /No downloadable/);
await assert.rejects(resolveTwitterMedia('4', '', { fetchImpl }), /returned 404/);
await assert.rejects(resolveTwitterMedia('5', '', { fetchImpl }), /readable post data/);
await assert.rejects(resolveTwitterMedia('8', '', { fetchImpl }), /returned 302/);
for (const id of ['6', '7'])
  await assert.rejects(resolveTwitterMedia(id, '', { fetchImpl }), /too much/);
await assert.rejects(
  resolveTwitterMedia('123', '', {
    fetchImpl: async () => {
      throw new DOMException('Aborted', 'AbortError');
    },
  }),
  { name: 'AbortError' },
);

const server = createWorkshopServer({ fetchImpl });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const origin = `http://127.0.0.1:${server.address().port}`,
    endpoint = `${origin}/api/twitter?id=123&media=2`,
    headers = { 'X-Emote-Workshop-Import': 'twitter' };
  const response = await fetch(endpoint, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { mediaUrl: high });
  const beforeBlocked = requested.length;
  for (const options of [
    {},
    { headers: { ...headers, Origin: 'https://evil.test' } },
    { method: 'POST', headers },
  ])
    assert.equal((await fetch(endpoint, options)).status, 403, JSON.stringify(options));
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = http.get(
      endpoint,
      { headers: { ...headers, Host: 'evil.test' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
  });
  assert.equal(reboundStatus, 403);
  assert.equal(
    (await fetch(`${origin}/api/twitter?id=https://localhost`, { headers })).status,
    400,
  );
  assert.equal(requested.length, beforeBlocked);
  const unavailable = await fetch(`${origin}/api/twitter?id=3`, { headers });
  assert.equal(unavailable.status, 502);
  assert.match((await unavailable.json()).error, /No downloadable/);
  assert.equal((await fetch(origin)).status, 200);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
console.log(
  'Twitter media selection, metadata limits, failures, and local resolver request guards passed',
);
