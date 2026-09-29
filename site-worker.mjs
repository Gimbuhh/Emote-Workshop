import { resolveTwitterMedia } from './twitter-import.mjs';

// Public post metadata only. The browser downloads media directly from Twitter.
export function createWorkshopWorker({ assets = {}, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Emote-Workshop-Import',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const json = (data, status = 200) => Response.json(data, { status, headers: cors });
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api/twitter') {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'GET')
          return json({ error: 'Use GET to import a public post.' }, 405);
        if (request.headers.get('X-Emote-Workshop-Import') !== 'twitter') {
          return json({ error: 'Use the editor to import a public post.' }, 403);
        }
        const id = url.searchParams.get('id') || '',
          index = url.searchParams.get('media') || '';
        if (!/^[1-9]\d{0,19}$/.test(id) || (index && !/^[1-9]\d?$/.test(index))) {
          return json({ error: 'Invalid Twitter/X post or media number.' }, 400);
        }
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
        try {
          return json(await resolveTwitterMedia(id, index, { fetchImpl, signal }));
        } catch (error) {
          return json(
            {
              error: signal.aborted
                ? 'Twitter/X took too long to respond. Try again or use a direct MP4 link.'
                : error.message === 'fetch failed'
                  ? 'Could not reach Twitter/X. Try again or use a direct MP4 link.'
                  : error.message,
            },
            502,
          );
        }
      }
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
      if (!asset) return new Response('Not found', { status: 404 });
      return new Response(
        request.method === 'HEAD'
          ? null
          : Uint8Array.from(atob(asset.body), (character) => character.charCodeAt(0)),
        {
          headers: {
            'Content-Type': asset.type,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      );
    },
  };
}
