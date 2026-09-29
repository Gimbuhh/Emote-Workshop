import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveTwitterMedia } from './twitter-import.mjs';
const root = path.resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
export function createWorkshopServer({ fetchImpl = fetch } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/twitter') {
        const port = server.address().port,
          origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
          origin = req.headers.origin;
        if (
          req.method !== 'GET' ||
          !origins.includes(`http://${req.headers.host}`) ||
          (origin && !origins.includes(origin)) ||
          req.headers['x-emote-workshop-import'] !== 'twitter'
        ) {
          res.writeHead(403).end('Local editor imports only');
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const id = url.searchParams.get('id') || '',
          index = url.searchParams.get('media') || '';
        if (!/^[1-9]\d{0,19}$/.test(id) || (index && !/^[1-9]\d?$/.test(index))) {
          res
            .writeHead(400)
            .end(JSON.stringify({ error: 'Invalid Twitter/X post or media number.' }));
          return;
        }
        const controller = new AbortController(),
          timeout = setTimeout(() => controller.abort(), 15000),
          disconnected = () => {
            if (!res.writableEnded) controller.abort();
          };
        res.on('close', disconnected);
        try {
          const media = await resolveTwitterMedia(id, index, {
            fetchImpl,
            signal: controller.signal,
          });
          res.end(JSON.stringify(media));
        } catch (error) {
          const message = controller.signal.aborted
            ? 'Twitter/X took too long to respond. Try again or use a direct MP4 link.'
            : error.message === 'fetch failed'
              ? 'Could not reach Twitter/X. Try again or use a direct MP4 link.'
              : error.message;
          res.writeHead(502).end(JSON.stringify({ error: message }));
        } finally {
          clearTimeout(timeout);
          res.off('close', disconnected);
        }
        return;
      }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createWorkshopServer().listen(4173, '127.0.0.1', () =>
    console.log('Emote Workshop: http://127.0.0.1:4173'),
  );
}
