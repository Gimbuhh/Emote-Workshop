const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await launchBrowser();
  try {
    for (const file of ['dist/index.html', 'Emote Workshop.html']) {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path.resolve(file)).href);
      const result = await page.evaluate(async () => {
        const engine = new EmoteEngine(),
          canvas = document.createElement('canvas'),
          context = canvas.getContext('2d'),
          width = 320,
          height = 320,
          frameCount = 40,
          delay = 100,
          frames = [];
        canvas.width = width;
        canvas.height = height;
        const pixels = context.createImageData(width, height);
        let random = 0x12345678;
        for (let index = 0; index < pixels.data.length; index += 4) {
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          pixels.data[index] = random & 255;
          pixels.data[index + 1] = (random >>> 8) & 255;
          pixels.data[index + 2] = (random >>> 16) & 255;
          pixels.data[index + 3] = Math.floor(index / 4 / width) < 100 ? 0 : 255;
        }
        for (let frame = 0; frame < frameCount; frame++) {
          context.putImageData(pixels, 0, 0);
          context.fillStyle = frame % 2 ? '#ffffff' : '#111111';
          context.fillRect(20 + frame * 6, 145, 24, 30);
          context.fillStyle = '#ff40d0';
          context.fillRect(20 + frame * 6, 40, 24, 30);
          frames.push(await createImageBitmap(canvas));
        }
        try {
          await engine.request(
            'loadVideo',
            {
              videoFrames: frames,
              frameDelays: Array(frameCount).fill(delay),
              details: {
                width,
                height,
                bytes: 1,
                originalFrames: frameCount,
                sampled: false,
              },
            },
            frames,
          );
          const output = (
              await engine.call('render', {
                mode: 'sticker',
                state: {
                  zoom: 100,
                  x: 0,
                  y: 0,
                  rotation: 0,
                  flip: false,
                  trim: false,
                  outline: 0,
                  color: '#ffffff',
                  brightness: 100,
                  width: 100,
                  stretch: 100,
                  speed: 100,
                },
              })
            )[0],
            decoder = new ImageDecoder({
              data: await output.blob.arrayBuffer(),
              type: output.blob.type,
            });
          await decoder.tracks.ready;
          let decodedDuration = 0,
            dimensionsOkay = true,
            pixelsOkay = true;
          const decodedCanvas = document.createElement('canvas'),
            decodedContext = decodedCanvas.getContext('2d');
          decodedCanvas.width = width;
          decodedCanvas.height = height;
          for (let index = 0; index < decoder.tracks.selectedTrack.frameCount; index++) {
            const decoded = (await decoder.decode({ frameIndex: index })).image;
            dimensionsOkay &&= decoded.displayWidth === width && decoded.displayHeight === height;
            decodedDuration += decoded.duration / 1000;
            decodedContext.clearRect(0, 0, width, height);
            decodedContext.drawImage(decoded, 0, 0);
            const moving = decodedContext.getImageData(32 + index * 6, 160, 1, 1).data,
              expectedMoving = index % 2 ? 255 : 16;
            pixelsOkay &&=
              moving[0] === expectedMoving &&
              moving[1] === expectedMoving &&
              moving[2] === expectedMoving &&
              moving[3] === 255;
            const transparentMotion = decodedContext.getImageData(32 + index * 6, 55, 1, 1).data;
            pixelsOkay &&=
              transparentMotion[0] === 255 &&
              transparentMotion[1] === 64 &&
              transparentMotion[2] === 208 &&
              transparentMotion[3] === 255;
            if (index) {
              const restoredX = 21 + (index - 1) * 6,
                restored = decodedContext.getImageData(restoredX, 160, 1, 1).data,
                sourceAt = (160 * width + restoredX) * 4;
              for (let channel = 0; channel < 3; channel++) {
                const source = pixels.data[sourceAt + channel],
                  expected = Math.min(255, Math.round(source / 8) * 8);
                pixelsOkay &&= restored[channel] === expected;
              }
              pixelsOkay &&= restored[3] === 255;
              pixelsOkay &&= decodedContext.getImageData(restoredX, 55, 1, 1).data[3] === 0;
            }
            decoded.close();
          }
          const decodedFrames = decoder.tracks.selectedTrack.frameCount;
          decoder.close();
          return {
            bytes: output.bytes,
            frames: output.frames,
            duration: output.duration,
            decodedFrames,
            decodedDuration,
            dimensionsOkay,
            pixelsOkay,
          };
        } finally {
          engine.close();
        }
      });
      assert(result.bytes <= 512 * 1024);
      assert.equal(result.frames, 40, 'Localized motion should not require frame sampling');
      assert.equal(result.duration, 4000);
      assert.equal(result.decodedFrames, 40);
      assert.equal(result.decodedDuration, 4000);
      assert.equal(result.dimensionsOkay, true);
      assert.equal(result.pixelsOkay, true, 'Delta frames restore and redraw changed pixels');
      console.log(`${file}: full-size APNG delta compression OK (${result.bytes} bytes)`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
