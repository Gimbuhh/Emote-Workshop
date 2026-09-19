const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
(async () => {
  const browser = await launchBrowser();
  try {
    for (const file of ['dist/index.html', 'Emote Workshop.html']) {
      const page = await browser.newPage(),
        errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve(file)).href);
      await page.click('#platform-seventv');
      assert.equal(await page.locator('html').getAttribute('data-platform'), 'seventv');
      assert.equal(await page.locator('#discord-types').isVisible(), false);
      assert.equal(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        ),
        '#7b3fc9',
      );
      const result = await page.evaluate(async () => {
        const engine = new EmoteEngine(),
          state = {
            zoom: 100,
            x: 0,
            y: 0,
            rotation: 0,
            flip: false,
            trim: false,
            outline: 0,
            color: '#ffffff',
            brightness: 100,
          },
          fixtures = [];
        try {
          for (const [width, height] of [
            [1000, 1000],
            [2031, 1000],
            [1406, 1000],
            [260, 128],
            [64, 128],
          ]) {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#aa71ff';
            ctx.fillRect(0, 0, width, height);
            const blob = await new Promise((resolve) => c.toBlob(resolve));
            await engine.call('load', {
              file: new File([blob], 'wide.png', { type: 'image/png' }),
            });
            const output = (await engine.call('render', { mode: 'seventv', state }))[0],
              bitmap = await createImageBitmap(output.blob);
            fixtures.push({
              width: output.width,
              height: output.height,
              decoded: [bitmap.width, bitmap.height],
              bytes: output.bytes,
              limit: output.limit,
            });
            bitmap.close();
          }
          const twitchStatic = await engine.call('render', { mode: 'twitch', state });
          const c = document.createElement('canvas');
          c.width = 260;
          c.height = 128;
          const ctx = c.getContext('2d'),
            frames = [];
          for (let f = 0; f < 12; f++) {
            ctx.clearRect(0, 0, 260, 128);
            ctx.fillStyle = '#aa71ff';
            ctx.fillRect(f * 10, 20, 30, 60);
            frames.push(await createImageBitmap(c));
          }
          await engine.request(
            'loadVideo',
            {
              videoFrames: frames,
              frameDelays: Array(12).fill(600),
              details: { width: 260, height: 128, bytes: 1, originalFrames: 12, sampled: false },
            },
            frames,
          );
          const all = await engine.call('all', {
            states: Object.fromEntries(
              ['twitch', 'emoji', 'sticker', 'seventv'].map((k) => [k, state]),
            ),
          });
          const ranged = await engine.call('all', {
            states: Object.fromEntries(
              ['twitch', 'emoji', 'sticker', 'seventv'].map((k) => [k, state]),
            ),
            ranges: {
              twitch: { start: 4, end: 9 },
              emoji: { start: 1, end: 4 },
              sticker: { start: 6, end: 11 },
              seventv: { start: 2, end: 11 },
            },
          });
          const rangedDurations = Object.fromEntries(
            Object.entries(ranged).map(([key, files]) => [key, files[0].duration]),
          );
          const output = all.seventv[0],
            decoder = new ImageDecoder({
              data: await output.blob.arrayBuffer(),
              type: 'image/gif',
            });
          await decoder.tracks.ready;
          let duration = 0;
          for (let f = 0; f < decoder.tracks.selectedTrack.frameCount; f++) {
            const frame = (await decoder.decode({ frameIndex: f })).image;
            if (frame.displayWidth !== 260 || frame.displayHeight !== 128)
              throw Error('Wrong animated dimensions');
            duration += frame.duration / 1000;
            frame.close();
          }
          decoder.close();
          const animationData = Array.from(new Uint8Array(await output.blob.arrayBuffer()));
          const tiny = document.createElement('canvas');
          tiny.width = tiny.height = 1;
          const tinyContext = tiny.getContext('2d'),
            twitchFrames = [];
          for (let f = 0; f < 120; f++) {
            tinyContext.fillStyle = `rgb(${f}, ${255 - f}, ${(f * 47) % 256})`;
            tinyContext.fillRect(0, 0, 1, 1);
            twitchFrames.push(await createImageBitmap(tiny));
          }
          await engine.request(
            'loadVideo',
            {
              videoFrames: twitchFrames,
              frameDelays: Array(120).fill(40),
              details: { width: 1, height: 1, bytes: 1, originalFrames: 120, sampled: false },
            },
            twitchFrames,
          );
          const twitchFrameLimited = (await engine.call('render', { mode: 'twitch', state }))[0];
          tinyContext.fillStyle = '#000000';
          tinyContext.fillRect(0, 0, 1, 1);
          const excessive = [];
          for (let f = 0; f < 241; f++) excessive.push(await createImageBitmap(tiny));
          let sourceFrameCap = false;
          try {
            await engine.request(
              'loadVideo',
              {
                videoFrames: excessive,
                frameDelays: Array(241).fill(20),
                details: { width: 1, height: 1, bytes: 1, originalFrames: 241, sampled: false },
              },
              excessive,
            );
          } catch (error) {
            sourceFrameCap = /at most 240 decoded frames/.test(error.message);
          }
          const invalidTimingFrames = [
            await createImageBitmap(tiny),
            await createImageBitmap(tiny),
          ];
          let invalidTiming = false;
          try {
            await engine.request(
              'loadVideo',
              {
                videoFrames: invalidTimingFrames,
                frameDelays: [20, Infinity],
                details: { width: 1, height: 1, bytes: 1, originalFrames: 2, sampled: false },
              },
              invalidTimingFrames,
            );
          } catch (error) {
            invalidTiming = /invalid frame timing/.test(error.message);
          }
          return {
            fixtures,
            keys: Object.keys(all),
            rangedDurations,
            animationData,
            sourceFrameCap,
            invalidTiming,
            twitchFrameLimited: {
              bytes: twitchFrameLimited.bytes,
              frames: twitchFrameLimited.frames,
              limit: twitchFrameLimited.limit,
            },
            twitchStatic: twitchStatic.map((item) => ({
              size: item.size,
              bytes: item.bytes,
              limit: item.limit,
              frames: item.frames,
            })),
            animation: {
              width: output.width,
              height: output.height,
              bytes: output.bytes,
              limit: output.limit,
              frames: output.frames,
              duration,
              reported: output.duration,
            },
            twitch: all.twitch.map((o) => ({
              size: o.size,
              bytes: o.bytes,
              limit: o.limit,
              frames: o.frames,
            })),
            discordDurations: [all.emoji[0].duration, all.sticker[0].duration],
          };
        } finally {
          engine.close();
        }
      });
      assert.deepEqual(
        result.fixtures.map((o) => [o.width, o.height]),
        [
          [1000, 1000],
          [1000, 492],
          [1000, 711],
          [260, 128],
          [64, 128],
        ],
      );
      for (const f of result.fixtures) {
        assert.deepEqual(f.decoded, [f.width, f.height]);
        assert.equal(f.limit, 7000000);
        assert(f.bytes <= f.limit);
      }
      assert.deepEqual(result.keys, ['twitch', 'emoji', 'sticker', 'seventv']);
      assert.deepEqual(
        result.twitchStatic.map((output) => output.size),
        [112, 56, 28],
      );
      assert(result.twitchStatic.every((output) => output.bytes <= 100 * 1024));
      assert(result.twitchStatic.every((output) => output.limit === 100 * 1024));
      assert(result.twitchStatic.every((output) => output.frames === 1));
      assert.deepEqual(
        result.twitch.map((output) => output.size),
        [112, 56, 28],
      );
      assert(result.twitch.every((output) => output.bytes <= 512 * 1024));
      assert(result.twitch.every((output) => output.limit === 512 * 1024));
      assert(result.twitch.every((output) => output.frames <= 60));
      assert(result.twitchFrameLimited.bytes <= 512 * 1024);
      assert.equal(result.twitchFrameLimited.limit, 512 * 1024);
      assert(result.twitchFrameLimited.frames <= 60);
      assert(result.discordDurations.every((d) => d <= 5000));
      assert.deepEqual(result.rangedDurations, {
        twitch: 3600,
        emoji: 2400,
        sticker: 3600,
        seventv: 6000,
      });
      assert.equal(result.animation.duration, 7200);
      assert.equal(result.animation.reported, 7200);
      assert(result.animation.frames <= 1000);
      assert(result.animation.bytes <= 7000000);
      assert(result.sourceFrameCap);
      assert(result.invalidTiming);
      await page.locator('#file-input').setInputFiles({
        name: 'wide.gif',
        mimeType: 'image/gif',
        buffer: Buffer.from(result.animationData),
      });
      delete result.animationData;
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      assert.match(await page.locator('#animation-range-summary').textContent(), /7\.2 s/);
      assert.match(await page.locator('#output-list').textContent(), /260 × 128/);
      assert.equal(await page.locator('#editor-canvas').getAttribute('width'), '800');
      assert.equal(await page.locator('#editor-canvas').getAttribute('height'), '394');
      const inline = await page.locator('.inline-emote').evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      }));
      assert.equal(inline.height, 32);
      assert.equal(inline.width, 65);
      await page.click('#animation-toggle');
      assert.equal(await page.locator('#animation-toggle').getAttribute('aria-pressed'), 'false');
      await page.click('#platform-twitch');
      assert.equal(await page.locator('#end-frame').inputValue(), '8');
      await page.evaluate(() => {
        const input = document.querySelector('#end-frame');
        input.value = '4';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.click('#platform-seventv');
      assert.equal(await page.locator('#end-frame').inputValue(), '12');
      assert.match(await page.locator('#animation-range-summary').textContent(), /7\.2 s/);
      await page.click('#platform-discord');
      assert.equal(await page.locator('#end-frame').inputValue(), '8');
      await page.click('#type-sticker');
      assert.equal(await page.locator('#end-frame').inputValue(), '8');
      await page.click('#platform-twitch');
      assert.equal(await page.locator('#end-frame').inputValue(), '4');
      await page.click('#platform-seventv');
      assert.equal(await page.locator('#end-frame').inputValue(), '12');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      const animatedDownloadPromise = page.waitForEvent('download');
      await page.click('#export-current');
      const animatedDownload = await animatedDownloadPromise;
      const animatedBuffer = readFileSync(await animatedDownload.path());
      const downloadedDuration = await page.evaluate(async (bytes) => {
        const decoder = new ImageDecoder({ data: new Uint8Array(bytes), type: 'image/gif' });
        await decoder.tracks.ready;
        let duration = 0;
        for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
          const frame = (await decoder.decode({ frameIndex: i })).image;
          duration += frame.duration / 1000;
          frame.close();
        }
        decoder.close();
        return duration;
      }, Array.from(animatedBuffer));
      assert.equal(downloadedDuration, 7200);
      const animatedZipPromise = page.waitForEvent('download');
      await page.click('#export-all');
      const animatedZip = await animatedZipPromise;
      const zipDurations = await page.evaluate(
        async (bytes) => {
          const zip = await JSZip.loadAsync(new Uint8Array(bytes));
          const durations = {};
          for (const [name, file] of Object.entries(zip.files)) {
            if (!name.endsWith('.gif')) continue;
            const decoder = new ImageDecoder({
              data: await file.async('uint8array'),
              type: 'image/gif',
            });
            await decoder.tracks.ready;
            let duration = 0;
            for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
              const frame = (await decoder.decode({ frameIndex: i })).image;
              duration += frame.duration / 1000;
              frame.close();
            }
            decoder.close();
            durations[name] = duration;
          }
          return durations;
        },
        Array.from(readFileSync(await animatedZip.path())),
      );
      assert.deepEqual(zipDurations, {
        'twitch/wide_twitch_112.gif': 2400,
        'twitch/wide_twitch_56.gif': 2400,
        'twitch/wide_twitch_28.gif': 2400,
        'emoji/wide_emoji_128.gif': 4800,
        'seventv/wide_seventv_260x128.gif': 7200,
      });
      await page.click('#sample');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.evaluate(() => {
        const input = document.querySelector('#zoom');
        input.value = '125';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.click('#platform-discord');
      assert.equal(await page.locator('#discord-types').isVisible(), true);
      await page.click('#platform-seventv');
      assert.equal(await page.locator('#zoom').inputValue(), '125');
      await page.click('#undo');
      assert.equal(await page.locator('#zoom').inputValue(), '90');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      const downloadPromise = page.waitForEvent('download');
      await page.click('#export-current');
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /_seventv_\d+x\d+\.png$/);
      const zipPromise = page.waitForEvent('download');
      await page.click('#export-all');
      const zip = await zipPromise;
      assert.match(zip.suggestedFilename(), /_all_destinations\.zip$/);
      assert.deepEqual(errors, []);
      console.log(file, JSON.stringify(result));
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
