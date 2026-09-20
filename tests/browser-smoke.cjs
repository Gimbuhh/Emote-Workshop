// Run with npm run test:browser. CHROME_PATH can override installed Google Chrome.
const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await launchBrowser();
  try {
    for (const file of ['dist/index.html', 'Emote Workshop.html']) {
      const page = await browser.newPage(),
        errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(file)).href);
      assert.equal(await page.locator('#platform-discord').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#platform-twitch').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#discord-types').isVisible(), true);
      const result = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d'),
          stream = canvas.captureStream(0),
          videoTrack = stream.getVideoTracks()[0];
        if (typeof videoTrack.requestFrame !== 'function')
          throw new Error('Manual canvas frame capture unavailable in test browser');
        if (!MediaRecorder.isTypeSupported('video/mp4'))
          throw new Error('MP4 recording unavailable in test browser');
        const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' }),
          chunks = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        const started = new Promise((resolve) => (recorder.onstart = resolve)),
          stopped = new Promise((resolve) => (recorder.onstop = resolve));
        recorder.start();
        ctx.fillStyle = '#294865';
        ctx.fillRect(0, 0, 128, 128);
        videoTrack.requestFrame();
        await started;
        for (let f = 0; f < 60; f++) {
          ctx.fillStyle = '#294865';
          ctx.fillRect(0, 0, 128, 128);
          ctx.fillStyle = '#ef9335';
          ctx.fillRect((f * 3) % 128, 45, 20, 20);
          videoTrack.requestFrame();
          await new Promise((resolve) => setTimeout(resolve, 1000 / 30));
        }
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        const engine = new EmoteEngine();
        try {
          const source = await engine.call('load', {
            file: new File(chunks, 'smoke.mp4', { type: 'video/mp4' }),
          });
          const state = {
            zoom: 90,
            x: 0,
            y: 0,
            rotation: 0,
            flip: false,
            trim: false,
            outline: 0,
            color: '#ffffff',
            brightness: 100,
          };
          const outputs = await engine.call('render', { mode: 'emoji', state });
          const output = outputs[0],
            decoder = new ImageDecoder({
              data: await output.blob.arrayBuffer(),
              type: 'image/gif',
            });
          await decoder.tracks.ready;
          let duration = 0;
          for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
            const frame = await decoder.decode({ frameIndex: i });
            duration += frame.image.duration / 1000;
            frame.image.close();
          }
          decoder.close();
          // High-entropy footage forces the palette/frame-rate budget fallback.
          const bitmaps = [];
          let seed = 123;
          for (let f = 0; f < 60; f++) {
            const data = ctx.createImageData(128, 128);
            for (let p = 0; p < data.data.length; p += 4) {
              seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
              data.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], p);
            }
            ctx.putImageData(data, 0, 0);
            bitmaps.push(await createImageBitmap(canvas));
          }
          await engine.request(
            'loadVideo',
            {
              videoFrames: bitmaps,
              frameDelays: Array(60).fill(1000 / 30),
              details: { width: 128, height: 128, bytes: 1, originalFrames: 60, sampled: false },
            },
            bitmaps,
          );
          const stress = (await engine.call('render', { mode: 'emoji', state }))[0];
          const stressDecoder = new ImageDecoder({
            data: await stress.blob.arrayBuffer(),
            type: 'image/gif',
          });
          await stressDecoder.tracks.ready;
          for (let i = 0; i < stressDecoder.tracks.selectedTrack.frameCount; i++) {
            const frame = await stressDecoder.decode({ frameIndex: i });
            frame.image.close();
          }
          stressDecoder.close();
          return {
            sourceFrames: source.frames,
            sourceDuration: source.duration,
            frames: output.frames,
            bytes: output.bytes,
            limit: output.limit,
            duration,
            reportedDuration: output.duration,
            stress: { frames: stress.frames, bytes: stress.bytes, duration: stress.duration },
          };
        } finally {
          engine.close();
        }
      });
      assert(result.sourceFrames >= 25, JSON.stringify(result));
      assert(result.frames >= 2, JSON.stringify(result));
      assert(result.bytes <= result.limit);
      assert.equal(result.duration, result.reportedDuration);
      assert(Math.abs(result.sourceDuration - result.duration) <= 10);
      assert(result.stress.bytes <= result.limit);
      assert(
        result.stress.frames >= 30,
        `GIF fallback discarded too many motion frames: ${JSON.stringify(result.stress)}`,
      );
      assert.equal(result.stress.duration, 2000);
      assert.deepEqual(errors, []);
      console.log(file, result);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
