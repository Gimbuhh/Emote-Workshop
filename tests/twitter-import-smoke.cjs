const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');

(async () => {
  const { createWorkshopServer } = await import('../serve.mjs'),
    { createWorkshopWorker } = await import('../site-worker.mjs'),
    { default: assets } = await import('../dist/server/assets.mjs'),
    mediaUrl = 'https://video.twimg.com/tweet_video/test-animation.mp4',
    resolvedIds = [],
    fetchImpl = async (url) => {
      const id = new URL(url).searchParams.get('id');
      resolvedIds.push(id);
      return Response.json(
        id === '2'
          ? {}
          : {
              mediaDetails: [
                {
                  type: 'animated_gif',
                  video_info: { variants: [{ content_type: 'video/mp4', url: mediaUrl }] },
                },
              ],
            },
      );
    },
    server = createWorkshopServer({ fetchImpl }),
    hosted = createWorkshopWorker({ assets, fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await launchBrowser();
  try {
    const recorderPage = await browser.newPage();
    const mp4 = Buffer.from(
      await recorderPage.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d'),
          stream = canvas.captureStream(0),
          track = stream.getVideoTracks()[0],
          recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' }),
          chunks = [];
        recorder.ondataavailable = (event) => chunks.push(event.data);
        const started = new Promise((resolve) => (recorder.onstart = resolve)),
          stopped = new Promise((resolve) => (recorder.onstop = resolve));
        recorder.start();
        context.fillStyle = '#ff8833';
        context.fillRect(0, 0, 32, 32);
        track.requestFrame();
        await started;
        for (let frame = 0; frame < 12; frame++) {
          context.fillStyle = frame % 2 ? '#3399ff' : '#ff8833';
          context.fillRect(0, 0, 32, 32);
          track.requestFrame();
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((item) => item.stop());
        return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
      }),
    );
    await recorderPage.close();
    for (const url of [
      pathToFileURL(path.resolve('dist/index.html')).href,
      pathToFileURL(path.resolve('Emote Workshop.html')).href,
      `http://127.0.0.1:${server.address().port}`,
      'https://emotes.gimba.uk/',
    ]) {
      const page = await browser.newPage(),
        errors = [],
        requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://emotes.gimba.uk/**', async (route) => {
        const request = route.request(),
          response = await hosted.fetch(
            new Request(request.url(), { method: request.method(), headers: request.headers() }),
          );
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
      await page.route('https://video.twimg.com/**', async (route) => {
        requests.push(route.request().url());
        const requested = route.request().url();
        if (requested.includes('empty'))
          await route.fulfill({ contentType: 'video/mp4', body: '' });
        else if (requested.includes('missing')) await route.fulfill({ status: 404 });
        else if (requested.includes('oversize'))
          await route.fulfill({
            contentType: 'video/mp4',
            body: mp4,
            headers: { 'content-length': String(101 * 1024 * 1024) },
          });
        else if (requested.includes('blocked')) await route.abort('failed');
        else await route.fulfill({ contentType: 'video/mp4', body: mp4 });
      });
      await page.goto(url);
      await page.click('#empty-import');
      const waitError = () =>
        page.waitForFunction(
          () =>
            document.querySelector('#link-import-status').classList.contains('error') &&
            !document.querySelector('#import-twitter').disabled,
        );
      for (const invalid of [
        'https://x.com.evil.test/name/status/123',
        'https://x.com/name/status/0',
        'https://video.twimg.com/tweet_video/test.m3u8',
        'https://user:pass@video.twimg.com/tweet_video/test.mp4',
      ]) {
        await page.fill('#twitter-link', invalid);
        await page.click('#import-twitter');
        await waitError();
      }
      assert.deepEqual(requests, []);
      await page.fill('#twitter-link', 'https://x.com/name/status/123?s=20');
      // Enter in Twitter's input must import Twitter rather than the first form button (7TV).
      await page.press('#twitter-link', 'Enter');
      await page.waitForFunction(() => !document.querySelector('#editor-canvas').hidden);
      assert.match(await page.locator('#source-name').textContent(), /^twitter_.*\.mp4$/);
      assert.match(await page.locator('#source-details').textContent(), /frames/);
      assert.equal(await page.locator('#import-dialog').isVisible(), false);
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      const downloadPromise = page.waitForEvent('download');
      await page.click('#export-current');
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /\.gif$/);
      const { readFile } = require('node:fs/promises'),
        exported = await readFile(await download.path());
      const exportedFrames = await page.evaluate(
        async (bytes) => {
          const decoder = new ImageDecoder({ data: new Uint8Array(bytes), type: 'image/gif' });
          await decoder.tracks.ready;
          const frames = decoder.tracks.selectedTrack.frameCount;
          decoder.close();
          return frames;
        },
        [...exported],
      );
      assert(exportedFrames > 1, 'Export must preserve animation');
      await page.click('#replace');
      for (const filename of ['empty', 'missing', 'oversize', 'blocked']) {
        await page.fill('#twitter-link', `https://video.twimg.com/tweet_video/${filename}.mp4`);
        await page.click('#import-twitter');
        await waitError();
        assert.equal(await page.locator('#browse-files').isEnabled(), true);
        assert.equal(await page.locator('#import-seventv').isEnabled(), true);
        assert.match(await page.locator('#source-name').textContent(), /^twitter_.*\.mp4$/);
      }
      {
        await page.fill('#twitter-link', 'https://mobile.twitter.com/name/status/2/video/1');
        await page.click('#import-twitter');
        await waitError();
        assert.match(await page.locator('#link-import-status').textContent(), /No downloadable/);
        await page.fill('#twitter-link', 'https://twitter.com/i/web/status/123/video/1');
        await page.click('#import-twitter');
        await page.waitForFunction(() => !document.querySelector('#import-dialog').open);
        await page.waitForFunction(
          () => document.querySelector('#source-name').textContent === 'twitter_123_1.mp4',
        );
      }
      assert.deepEqual(errors, []);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForFunction(() => !document.querySelector('#replace').disabled);
      if (!(await page.locator('#import-dialog').isVisible())) await page.click('#replace');
      const overflow = await page
        .locator('#import-dialog')
        .evaluate((element) => element.scrollWidth > element.clientWidth);
      assert.equal(overflow, false, 'Import dialog should fit a mobile viewport');
      console.log(url, 'Twitter MP4 import, animated GIF export, validation, and recovery passed');
      await page.close();
    }
    assert(resolvedIds.includes('123'));
    assert(resolvedIds.includes('2'));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
