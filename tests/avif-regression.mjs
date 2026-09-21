// Real AVIF containers plus isolated media-API doubles; no browser UI required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/engine.js', import.meta.url), 'utf8');
const anchor = /let queue\s*=\s*Promise\.resolve\(\);/;
assert(anchor.test(source));
const fixtures = Object.fromEntries(
  ['still', 'animated'].map((name) => [
    name,
    new Uint8Array(readFileSync(new URL(`fixtures/${name}.avif`, import.meta.url))),
  ]),
);
const bitmaps = [],
  mediaFrames = [],
  decoders = [];
let supported = true,
  failAt = -1;
class Decoder {
  static async isTypeSupported(mime) {
    assert.equal(mime, 'image/avif');
    return supported;
  }
  constructor(options) {
    assert.equal(options.type, 'image/avif');
    assert.equal(options.preferAnimation, true);
    this.options = options;
    this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } };
    this.completed = Promise.resolve().then(() => {
      this.tracks.selectedTrack.frameCount = 3;
    });
    decoders.push(this);
  }
  async decode({ frameIndex }) {
    if (frameIndex === failAt) throw new Error('Decode failed');
    const image = {
      displayWidth: 32,
      displayHeight: 16,
      duration: [80000, 160000, 240000][frameIndex],
      close() {
        this.closed = true;
      },
    };
    mediaFrames.push(image);
    return { image };
  }
  close() {
    this.closed = true;
  }
}
class Canvas {
  constructor(width, height) {
    Object.assign(this, { width, height });
  }
  getContext() {
    return {
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ data: new Uint8Array(this.width * this.height * 4).fill(255) }),
    };
  }
  async convertToBlob() {
    return new Blob(['preview'], { type: 'image/png' });
  }
}
const context = {
  self: { ImageDecoder: Decoder },
  window: {},
  ImageDecoder: Decoder,
  Uint8Array,
  DataView,
  TextEncoder,
  Blob,
  OffscreenCanvas: Canvas,
  async createImageBitmap(input) {
    if (input instanceof Blob) assert.equal(input.type, ''); // No MIME supplied: sniff contents.
    const bitmap = {
      width: 32,
      height: 16,
      close() {
        this.closed = true;
      },
    };
    bitmaps.push(bitmap);
    return bitmap;
  },
};
vm.runInNewContext(
  source.replace(anchor, 'self.test = {inspect, load}; let queue = Promise.resolve();') +
    '\nimageWorker();',
  context,
);
const { inspect, load } = context.self.test;
for (const [name, bytes] of Object.entries(fixtures)) {
  const metadata = inspect(bytes);
  assert.equal(metadata.type, 'AVIF');
  assert.equal(metadata.mime, 'image/avif');
  assert.deepEqual([metadata.width, metadata.height], [32, 16]);
  assert.equal(metadata.animated, name === 'animated');
}
const still = await load(new Blob([fixtures.still]));
assert.equal(still.animated, false);
assert.equal(still.frames, 1);
assert.equal(still.animationPreview, null);
const progress = [];
const animation = await load(new Blob([fixtures.animated]), (event) => progress.push(event));
assert.equal(animation.animated, true);
assert.equal(animation.originalFrames, 3);
assert.equal(animation.animationPreview.type, 'image/avif');
assert.equal(animation.animationPreview.size, fixtures.animated.byteLength);
assert.deepEqual(Array.from(animation.frameDelays), [80, 160, 240]);
assert.equal(animation.duration, 480);
assert.deepEqual(
  progress.map(({ phase, current, total }) => [phase, current, total]),
  [
    ['decode', 0, 3],
    ['decode', 3, 3],
    ['analyze', 0, 3],
    ['analyze', 3, 3],
  ],
);
assert.equal(bitmaps[0].closed, true, 'Replacing the source closes old frames');
assert(mediaFrames.every((frame) => frame.closed));
assert(decoders.every((decoder) => decoder.closed));
supported = false;
await assert.rejects(load(new Blob([fixtures.animated])), /cannot decode animated AVIF/);
supported = true;
failAt = 1;
await assert.rejects(load(new Blob([fixtures.animated])), /Decode failed/);
assert.equal(bitmaps.at(-1).closed, true, 'Partial animation frames are released on failure');
assert(decoders.every((decoder) => decoder.closed));
delete context.self.ImageDecoder;
await assert.rejects(load(new Blob([fixtures.animated])), /current Chromium browser/);

const truncated = fixtures.still.slice(0, 25);
assert.throws(() => inspect(truncated), /incomplete or damaged/);
const wrongBrand = fixtures.still.slice();
wrongBrand.set(Buffer.from('heic'), 8);
for (let p = 16; p < new DataView(wrongBrand.buffer).getUint32(0); p += 4)
  wrongBrand.set(Buffer.from('heic'), p);
assert.throws(() => inspect(wrongBrand), /not an AVIF/);
const huge = fixtures.still.slice();
const ispe = Buffer.from(huge).indexOf('ispe');
assert(ispe >= 0);
new DataView(huge.buffer).setUint32(ispe + 8, 20001);
assert.throws(() => inspect(huge), /48-megapixel/);
const zeroBox = fixtures.still.slice();
new DataView(zeroBox.buffer).setUint32(0, 4);
assert.throws(() => inspect(zeroBox), /incomplete or damaged/);
console.log('Static/animated AVIF detection, import routing, timing, limits, and cleanup OK');
