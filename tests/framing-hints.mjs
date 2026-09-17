// Exercise production bounds and hint logic without native browser media APIs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const engine = readFileSync(new URL('../dist/engine.js', import.meta.url), 'utf8');
const start = engine.indexOf('  function findBounds(');
const end = engine.indexOf('  async function load(', start);
assert(start >= 0 && end > start);
let lastCanvas;
const boundsContext = vm.createContext({
  makeCanvas(width, height) {
    let current;
    lastCanvas = {
      width,
      height,
      getContext: () => ({
        clearRect() {
          current = null;
        },
        drawImage(frame) {
          current = frame;
        },
        getImageData() {
          const data = new Uint8ClampedArray(width * height * 4);
          for (const [x, y] of current.pixels) data[(y * width + x) * 4 + 3] = 255;
          return { data };
        },
      }),
      get current() {
        return current;
      },
    };
    return lastCanvas;
  },
});
vm.runInContext(engine.slice(start, end), boundsContext);
const frame = (pixels) => ({ width: 10, height: 10, pixels });
const first = frame([[3, 3]]),
  moving = frame([[7, 6]]),
  empty = frame([]);
let measured = boundsContext.findBounds([first, moving]);
assert.deepEqual({ ...measured.preview }, { x: 2, y: 2, w: 7, h: 6 });
assert.equal(measured.hasTransparency, true);
assert.equal(lastCanvas.current, first, 'Preview must remain the first frame');
measured = boundsContext.findBounds([empty, moving]);
assert.deepEqual({ ...measured.preview }, { x: 6, y: 5, w: 3, h: 3 });
assert.throws(() => boundsContext.findBounds([empty]), /fully transparent/);
measured = boundsContext.findBounds([
  frame([
    [0, 0],
    [9, 9],
  ]),
  empty,
]);
assert.deepEqual({ ...measured.preview }, { x: 0, y: 0, w: 10, h: 10 });

const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const firstHint = app.indexOf('  function effectiveBounds(');
const lastHint = app.indexOf('  function syncSliderValue(', firstHint);
assert(firstHint >= 0 && lastHint > firstHint);
const elements = Object.fromEntries(['trim', 'trim-hint', 'fill'].map((id) => [id, {}]));
const context = vm.createContext({
  mode: 'emoji',
  importing: false,
  exporting: false,
  source: { bounds: { x: 0, y: 0, w: 384, h: 128 } },
  editorImage: { width: 384, height: 128 },
  state: () => ({ trim: false }),
  $: (id) => elements[id],
});
vm.runInContext(app.slice(firstHint, lastHint), context);
context.syncFramingHints();
assert.equal(elements.trim.disabled, true);
assert.equal(
  elements['trim-hint'].textContent,
  'No transparent margins found. This source is opaque.',
);
context.source.hasTransparency = true;
context.syncFramingHints();
assert.equal(
  elements['trim-hint'].textContent,
  'No outer margins to trim. Artwork reaches every edge.',
);
assert.equal(elements.fill.textContent, 'Fill');
assert.equal(context.fillZoom({ trim: false }), 300);
assert.equal(context.fillZoom({ trim: false, stretch: 200 }), 150);
assert.equal(context.fillZoom({ trim: false, stretch: 300 }), 100);
context.mode = 'seventv';
context.syncFramingHints();
assert.equal(elements.fill.textContent, 'Fill');
assert.equal(context.fillZoom({ trim: false }), 100);
context.source.bounds = { x: 10, y: 5, w: 300, h: 100 };
context.syncFramingHints();
assert.equal(elements.trim.disabled, false);
assert.equal(elements['trim-hint'].textContent, 'Crop the canvas to visible artwork.');
context.importing = true;
context.syncFramingHints();
assert.equal(elements.trim.disabled, true);
context.importing = false;
context.mode = 'twitch';
context.editorImage = { width: 128, height: 128 };
context.source.bounds = { x: 0, y: 0, w: 128, h: 128 };
context.syncFramingHints();
context.source = null;
context.syncFramingHints();
assert.equal(elements.trim.disabled, true);

// The same renderer serves still/editor frames and every animated/export frame.
const rendererEnd = engine.indexOf('\nfunction imageWorker()');
const renderer = vm.createContext({});
vm.runInContext(engine.slice(0, rendererEnd), renderer);
const transforms = [],
  drawing = {
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    drawImage() {},
    scale(x, y) {
      transforms.push([x, y]);
    },
  },
  settings = {
    zoom: 90,
    x: 0,
    y: 0,
    rotation: 0,
    flip: false,
    trim: false,
    outline: 0,
    brightness: 100,
  };
const draw = (stretch) =>
  renderer.drawArtwork(
    drawing,
    { width: 384, height: 128 },
    { ...settings, stretch },
    128,
    {},
    () => {
      throw new Error('No outline canvas expected');
    },
  );
draw(undefined);
draw(100);
draw(200);
draw(300);
assert.deepEqual(transforms[0], transforms[1], 'Default rendering must be unchanged');
assert.equal(transforms[2][0], transforms[1][0], 'A wide image keeps its width');
assert.equal(transforms[2][1], transforms[1][1] * 2, 'Height doubles, not uniform scale');
assert.equal(transforms[3][1] / transforms[3][0], 3);

const checkStart = engine.indexOf('  function checkState('),
  checkEnd = engine.indexOf('  function selectedAnimation(', checkStart);
vm.runInContext(engine.slice(checkStart, checkEnd), renderer);
const valid = { ...settings, color: '#ffffff' };
renderer.checkState(valid);
renderer.checkState({ ...valid, stretch: 200 });
for (const stretch of [0, 99, 301, NaN, Infinity, '150'])
  assert.throws(() => renderer.checkState({ ...valid, stretch }), /Invalid editing settings/);
const uploadStart = app.indexOf('  function uploadSize()'),
  uploadEnd = app.indexOf('  function editorSize()', uploadStart);
vm.runInContext(app.slice(uploadStart, uploadEnd), context);
context.source = { width: 384, height: 128, bounds: { w: 384, h: 128 } };
context.editorImage = { width: 384, height: 128 };
context.state = () => ({ stretch: 200, trim: false });
assert.deepEqual({ ...context.uploadSize() }, { width: 384, height: 256 });
context.source = { width: 800, height: 800 };
assert.deepEqual({ ...context.uploadSize() }, { width: 500, height: 1000 });
console.log('Framing hints and animation-union bounds passed.');
