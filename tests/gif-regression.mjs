// Run with node tests/gif-regression.mjs [output directory] [old engine path].
// Decode the generated fixtures with verify-gif.py (Pillow) for an independent check.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const destination = process.argv[2] || 'tests/output';
mkdirSync(destination, { recursive: true });
function engine(path) {
  const text = readFileSync(path, 'utf8'),
    anchor = /let queue\s*=\s*Promise\.resolve\(\);/;
  assert(anchor.test(text), 'Worker test anchor missing');
  const source = text.replace(
    anchor,
    'self.test={encodeGif,makePalette,selectedAnimation,checkRenderBudget,renderPlan,sourceFrameStride,setDelays(values){delays=values;frames=Array(values.length);},setAnimation(count,delay=40){delays=Array(count).fill(delay);frames=Array(count);}};let queue=Promise.resolve();',
  );
  const context = { self: {}, window: {}, TextEncoder, Uint8Array, Uint32Array, Float64Array };
  vm.runInNewContext(source + '\nimageWorker();', context);
  return context.self.test;
}
const current = engine(new URL('../dist/engine.js', import.meta.url)),
  old = process.argv[3] ? engine(process.argv[3]) : null;
assert.equal(
  current.sourceFrameStride(158, 128, 128),
  1,
  'Small animated emotes retain their original frame rate',
);
assert.equal(current.sourceFrameStride(241, 128, 128), 2, 'The absolute frame cap still applies');
assert.equal(
  current.sourceFrameStride(240, 512, 512),
  2,
  'Large animations are sampled to stay within the decoded-pixel budget',
);
current.setDelays(Array(240).fill(1000 / 30));
const selection = current.selectedAnimation(5000);
assert.equal(selection.duration, 5000);
assert.equal(selection.selected.length, 150);
current.setDelays(Array(160).fill(32));
assert.equal(current.selectedAnimation(5000).duration, 5000);
current.setDelays([60, 120, 180]);
assert.equal(current.selectedAnimation(Infinity, 1, null, 50).duration, 720);
assert.equal(current.selectedAnimation(Infinity, 1, null, 150).duration, 240);
assert.deepEqual(
  Array.from(current.selectedAnimation(Infinity, 2, null, 50).selectedDelays),
  [360, 360],
);
current.setDelays([20, 20]);
assert.equal(
  current.selectedAnimation(Infinity, 1, null, 150).duration,
  40,
  'Browser-safe minimum timing',
);
current.setDelays(Array(100).fill(100));
assert.equal(
  current.selectedAnimation(5000, 1, null, 50).selected.length,
  25,
  'Duration limits apply after speed',
);
assert.doesNotThrow(() => current.checkRenderBudget(512, 512, 120));
assert.doesNotThrow(() => current.checkRenderBudget(1000, 100, 240));
assert.throws(() => current.checkRenderBudget(512, 512, 240), /too large to process safely/);
assert.throws(() => current.checkRenderBudget(1000, 1000, 240), /too large to process safely/);
current.setAnimation(240);
const squarePlan = current.renderPlan(
    1000,
    1000,
    { duration: Infinity, maxFrames: 1000 },
    null,
    100,
  ),
  mediumPlan = current.renderPlan(512, 512, { duration: Infinity, maxFrames: 1000 }, null, 100),
  widePlan = current.renderPlan(1000, 100, { duration: Infinity, maxFrames: 1000 }, null, 100);
assert.equal(squarePlan.selected.length, 30);
assert.equal(mediumPlan.selected.length, 120);
assert.equal(widePlan.selected.length, 240);
assert.equal(squarePlan.duration, 9600);
assert.equal(mediumPlan.duration, 9600);
assert.equal(widePlan.duration, 9600);
current.setAnimation(1001);
assert.throws(
  () => current.renderPlan(1, 1, { duration: Infinity, maxFrames: 1000 }, null, 100),
  /at most 1000 frames/,
  'Destination frame limits apply before sampling',
);
const longFrame = new Uint8Array([120, 80, 40, 255]),
  longDelay = current.encodeGif([longFrame], 1, 1, [700000], 64),
  serializedDelays = [];
for (let i = 0; i + 7 < longDelay.bytes.length; i++) {
  if (
    longDelay.bytes[i] === 0x21 &&
    longDelay.bytes[i + 1] === 0xf9 &&
    longDelay.bytes[i + 2] === 0x04
  ) {
    serializedDelays.push(longDelay.bytes[i + 4] | (longDelay.bytes[i + 5] << 8));
  }
}
assert.equal(longDelay.frames, 2);
assert(serializedDelays.every((delay) => delay <= 65535));
assert.equal(serializedDelays.reduce((sum, delay) => sum + delay, 0) * 10, 700000);
assert.equal(longDelay.duration, 700000);
assert.throws(() => current.encodeGif([longFrame], 1, 1, [Infinity], 64), /invalid frame timing/);
assert.throws(
  () => current.encodeGif([longFrame], 1, 1, [1966060], 64, 3),
  /at most 3 timing frames/,
);
const width = 128,
  height = 128,
  manifest = [];
for (const kind of ['motion', 'transparent', 'duplicates', 'noise', 'rare-colors']) {
  const count = kind === 'motion' ? 150 : kind === 'duplicates' ? 12 : 10,
    frames = [];
  let seed = 123;
  for (let f = 0; f < count; f++) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4,
          moving = x >= f % 90 && x < (f % 90) + 20 && y >= 45 && y < 65;
        let color;
        if (kind === 'noise') {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          color = [seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255];
        } else if (kind === 'rare-colors')
          color =
            x < 110
              ? [120 + (x % 8), 130 + (y % 8), 140 + ((x + y) % 8), 255]
              : [(x * 37 + f * 19) % 256, y * 2, (x * y) % 256, 255];
        else if (kind === 'transparent') color = moving ? [240, 80, 32, 255] : [0, 0, 0, 0];
        else if (kind === 'duplicates') color = [30, 60, 90, 255];
        else color = moving ? [250, 80, 24, 255] : [x * 2, y * 2, 100, 255];
        rgba.set(color, p);
      }
    frames.push(rgba);
  }
  const delays = Array(count).fill(1000 / 30),
    result = current.encodeGif(frames, width, height, delays, 256);
  assert.equal(result.duration, Math.round((count * 1000) / 30 / 10) * 10);
  if (kind === 'duplicates') assert.equal(result.frames, 1);
  writeFileSync(`${destination}/${kind}.gif`, result.bytes);
  writeFileSync(`${destination}/${kind}.rgba`, Buffer.concat(frames.map((f) => Buffer.from(f))));
  // Full-canvas quantized expected pixels allow disposal/delta testing separately from quantization loss.
  const { table, lookup } = current.makePalette(frames, 256),
    expected = [];
  for (const frame of frames) {
    const pixels = new Uint8Array(frame.length);
    for (let p = 0; p < frame.length; p += 4) {
      if (frame[p + 3] < 128) continue;
      const index =
        lookup[((frame[p] >> 3) << 10) | ((frame[p + 1] >> 3) << 5) | (frame[p + 2] >> 3)];
      pixels.set(table.subarray(index * 3, index * 3 + 3), p);
      pixels[p + 3] = 255;
    }
    expected.push(pixels);
  }
  writeFileSync(
    `${destination}/${kind}.expected`,
    Buffer.concat(expected.map((f) => Buffer.from(f))),
  );
  let oldBytes = null;
  if (old) {
    const bytes = old.encodeGif(frames, width, height, delays, 128);
    oldBytes = bytes.length;
    writeFileSync(`${destination}/${kind}.old.gif`, bytes);
  }
  manifest.push({
    kind,
    width,
    height,
    count,
    frames: result.frames,
    duration: result.duration,
    bytes: result.bytes.length,
    oldBytes,
  });
}
writeFileSync(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
