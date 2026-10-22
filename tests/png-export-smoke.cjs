const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const browser = await launchBrowser();
  try {
    for (const file of ['dist/index.html', 'Emote Workshop.html']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.__previewBlobs = new Map();
        const create = URL.createObjectURL.bind(URL),
          revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          window.__previewBlobs.set(url, blob);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          window.__previewBlobs.delete(url);
          revoke(url);
        };
      });
      await page.goto(pathToFileURL(path.resolve(file)).href);
      assert.equal(await page.locator('#emoji-size').inputValue(), '128');
      assert.equal(await page.locator('#preview-resolution').isVisible(), false);
      const bytes = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 2172;
        canvas.height = 724;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#fe1050');
        gradient.addColorStop(0.5, '#2877e3');
        gradient.addColorStop(1, '#20ee80');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(0, 0, 200, 200);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'white';
        ctx.fillRect(900, 0, 300, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve));
        return [...new Uint8Array(await blob.arrayBuffer())];
      });
      await page.locator('#file-input').setInputFiles({
        name: 'wide-master.png',
        mimeType: 'image/png',
        buffer: Buffer.from(bytes),
      });
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.locator('#zoom-value').fill('100');
      await page.locator('#zoom-value').press('Enter');
      await page.locator('#stretch-value').fill('230');
      await page.locator('#stretch-value').press('Enter');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      assert.match(await page.locator('#preview-resolution').textContent(), /Export: 128 × 128 px/);
      assert.equal(await page.locator('#editor-canvas').getAttribute('width'), '800');
      assert.doesNotMatch(await page.locator('#output-list').textContent(), /unavailable/);
      await page.click('#compare-toggle');
      await page.locator('#converted-preview').evaluate((image) => image.decode());
      assert.match(
        await page.locator('#compare-original-meta').textContent(),
        /^PNG · 2172 × 724 · /,
      );
      assert.match(await page.locator('#compare-converted-meta').textContent(), /^PNG · 128 × 128/);
      const assertCaptionAlignment = async () => {
        const boxes = await page.locator('#converted-pane').evaluate((pane) => {
          const heading = pane.querySelector('figcaption strong').getBoundingClientRect();
          const preview = pane.querySelector('.converted-wrap').getBoundingClientRect();
          const meta = pane.querySelector('figcaption span').getBoundingClientRect();
          return {
            headingX: heading.x,
            previewX: preview.x,
            previewRight: preview.right,
            metaRight: meta.right,
          };
        });
        assert(
          Math.abs(boxes.headingX - boxes.previewX) < 1,
          'Converted heading aligns with its preview',
        );
        assert(
          boxes.metaRight <= boxes.previewRight + 1,
          'Converted metadata fits the preview width',
        );
      };
      await assertCaptionAlignment();
      const width = () =>
        page.locator('#converted-preview').evaluate((image) => image.getBoundingClientRect().width);
      assert.equal(await width(), 128, 'Compare defaults to the export at native size');
      const originalSize = await page
        .locator('#converted-preview')
        .evaluate((image) => [image.naturalWidth, image.naturalHeight]);
      assert.deepEqual(originalSize, [128, 128]);
      await page.click('#converted-size-toggle');
      assert.equal(
        await page.locator('#converted-size-toggle').getAttribute('aria-pressed'),
        'false',
      );
      assert((await width()) > 128, 'Enlarged view remains available for inspecting edges');
      await assertCaptionAlignment();
      await page.click('#converted-size-toggle');
      const shown = await page
        .locator('#converted-preview')
        .evaluate(async (image) => [
          ...new Uint8Array(await window.__previewBlobs.get(image.src).arrayBuffer()),
        ]);
      const downloadPromise = page.waitForEvent('download');
      await page.click('#export-current');
      const download = await downloadPromise;
      const downloaded = await readFile(await download.path());
      assert.deepEqual(downloaded, Buffer.from(shown), 'Compare shows exactly the downloaded PNG');
      const decoded = await page.evaluate(
        async (bytes) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          );
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const colors = new Set(),
            alphas = new Set();
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3]) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
            alphas.add(data[i + 3]);
          }
          bitmap.close();
          return { colors: colors.size, alphas: alphas.size };
        },
        [...downloaded],
      );
      assert(decoded.colors > 256, 'Static PNG exports retain full color, without a GIF palette');
      assert(decoded.alphas > 2, 'Downscaled edges preserve partial transparency');
      assert(downloaded.length < 256 * 1024);
      await page.locator('#emoji-size').selectOption('256');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.locator('#converted-preview').evaluate((image) => image.decode());
      assert.match(await page.locator('#destination-hint').textContent(), /^256 × 256 px/);
      assert.match(await page.locator('#output-list').textContent(), /256 × 256/);
      assert.equal(await width(), 256, 'Actual-size preview follows the selected emoji size');
      await assertCaptionAlignment();
      assert.equal(await page.locator('#zoom-value').inputValue(), '100');
      assert.equal(await page.locator('#stretch-value').inputValue(), '230');
      assert.deepEqual(
        await page
          .locator('#converted-preview')
          .evaluate((image) => [image.naturalWidth, image.naturalHeight]),
        [256, 256],
      );
      const largeDownloadPromise = page.waitForEvent('download');
      await page.click('#export-current');
      const largeDownload = await largeDownloadPromise;
      assert.match(largeDownload.suggestedFilename(), /_emoji_256\.png$/);
      const largeBytes = await readFile(await largeDownload.path());
      assert(largeBytes.length < 256 * 1024);
      assert.deepEqual(
        largeBytes,
        Buffer.from(
          await page
            .locator('#converted-preview')
            .evaluate(async (image) => [
              ...new Uint8Array(await window.__previewBlobs.get(image.src).arrayBuffer()),
            ]),
        ),
        'The selected 256 px preview is the exact downloaded file',
      );
      const zipPromise = page.waitForEvent('download');
      await page.click('#export-all');
      const zipDownload = await zipPromise;
      const zipBytes = await readFile(await zipDownload.path());
      const packed = await page.evaluate(
        async (bytes) => {
          const zip = await JSZip.loadAsync(new Uint8Array(bytes));
          const emoji = Object.keys(zip.files).find(
            (name) => name.startsWith('emoji/') && name.endsWith('.png'),
          );
          const png = await zip.file(emoji).async('uint8array');
          const image = await createImageBitmap(new Blob([png], { type: 'image/png' }));
          const result = { name: emoji, width: image.width, height: image.height };
          image.close();
          return result;
        },
        [...zipBytes],
      );
      assert.match(packed.name, /_emoji_256\.png$/);
      assert.deepEqual([packed.width, packed.height], [256, 256]);
      for (const viewportWidth of [375, 320]) {
        await page.setViewportSize({ width: viewportWidth, height: 900 });
        assert.equal(await page.locator('#converted-size-toggle').isVisible(), true);
        assert.equal(
          await page
            .locator('#converted-size-toggle')
            .evaluate((button) => button.scrollWidth <= button.clientWidth),
          true,
          'The actual-size button label fits on mobile',
        );
        assert((await width()) <= 256, 'Native export view never enlarges on mobile');
        await assertCaptionAlignment();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          viewportWidth,
        );
      }
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.click('#type-sticker');
      assert.equal(await page.locator('#emoji-size-control').isVisible(), false);
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.locator('#converted-preview').evaluate((image) => image.decode());
      assert.equal(await width(), 320, 'Native-size view follows the selected destination');
      assert.match(await page.locator('#compare-converted-meta').textContent(), /^PNG · 320 × 320/);
      assert.doesNotMatch(await page.locator('#output-list').textContent(), /unavailable/);
      await page.click('#compare-toggle');
      assert.match(await page.locator('#preview-resolution').textContent(), /Export: 320 × 320 px/);
      await page.click('#type-emoji');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      assert.equal(await page.locator('#emoji-size').inputValue(), '256');
      assert.match(await page.locator('#preview-resolution').textContent(), /Export: 256 × 256 px/);
      await page.locator('#emoji-size').selectOption('128');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      assert.match(await page.locator('#output-list').textContent(), /128 × 128/);
      const animated = await page.evaluate(async () => {
        const engine = new EmoteEngine();
        const canvas = new OffscreenCanvas(256, 256),
          ctx = canvas.getContext('2d');
        const frames = [],
          delays = [80, 120, 160, 200];
        const state = {
          zoom: 100,
          x: 0,
          y: 0,
          rotation: 0,
          flip: false,
          trim: false,
          outline: 0,
          color: '#ffffff',
          brightness: 100,
        };
        try {
          for (let i = 0; i < delays.length; i++) {
            ctx.clearRect(0, 0, 256, 256);
            ctx.fillStyle = ['#fa5070', '#20aaee', '#78cc44', '#ffb840'][i];
            ctx.beginPath();
            ctx.arc(60 + i * 30, 128, 45, 0, Math.PI * 2);
            ctx.fill();
            frames.push(await createImageBitmap(canvas));
          }
          await engine.request(
            'loadVideo',
            {
              videoFrames: frames,
              frameDelays: delays,
              details: { width: 256, height: 256, bytes: 1, originalFrames: 4, sampled: false },
            },
            frames,
          );
          for (const size of [64, 129, 512, '256']) {
            let rejected = false;
            try {
              await engine.call('render', { mode: 'emoji', state, emojiSize: size });
            } catch (error) {
              rejected = /emoji size/.test(error.message);
            }
            if (!rejected) throw new Error(`Invalid emoji size accepted: ${size}`);
          }
          const output = (await engine.call('render', { mode: 'emoji', state, emojiSize: 256 }))[0];
          const decoder = new ImageDecoder({
            data: await output.blob.arrayBuffer(),
            type: 'image/gif',
          });
          try {
            await decoder.tracks.ready;
            let duration = 0;
            for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
              const { image } = await decoder.decode({ frameIndex: i });
              if (image.displayWidth !== 256 || image.displayHeight !== 256)
                throw new Error('Incorrect animated dimensions');
              duration += image.duration / 1000;
              image.close();
            }
            return {
              width: output.width,
              height: output.height,
              frames: decoder.tracks.selectedTrack.frameCount,
              duration,
              bytes: output.bytes,
              limit: output.limit,
            };
          } finally {
            decoder.close();
          }
        } finally {
          engine.close();
        }
      });
      assert.deepEqual(
        [animated.width, animated.height, animated.frames, animated.duration],
        [256, 256, 4, 560],
      );
      assert(animated.bytes <= animated.limit && animated.limit < 256 * 1024);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        file,
        '128/256 PNG/GIF, timing, ZIP size, validation, exact download preview, mobile OK',
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
