// Production timeline functions and handlers with isolated UI/media doubles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const text = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
assert.match(
  styles,
  /\.frame-timeline\s*\{[^}]*user-select:\s*none/,
  'Filmstrip must not allow native browser selection',
);
assert.match(
  styles,
  /\.timeline-frames img\s*\{[^}]*-webkit-user-drag:\s*none/,
  'Thumbnails must not start native image drags',
);
function section(start, end) {
  const a = text.indexOf(start),
    b = text.indexOf(end, a);
  assert(a >= 0 && b > a);
  return text.slice(a, b);
}
class Element {
  constructor() {
    this.listeners = {};
    this.attributes = {};
    this.children = [];
    this.style = { setProperty: (key, value) => (this.attributes[key] = value) };
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }
  addEventListener(key, fn) {
    this.listeners[key] = fn;
  }
  replaceChildren() {
    this.children = [];
  }
  append(item) {
    this.children.push(item);
  }
  focus() {}
  setPointerCapture(id) {
    this.capture = id;
  }
  getBoundingClientRect() {
    return { width: 200 };
  }
  emit(key, props = {}) {
    this.listeners[key]({ preventDefault() {}, ...props });
  }
}
const ids = [
    'frame-timeline',
    'timeline-frames',
    'timeline-status',
    'trim-start-handle',
    'trim-end-handle',
    'start-frame',
    'end-frame',
  ],
  elements = Object.fromEntries(ids.map((id) => [id, new Element()])),
  revoked = [],
  requests = [],
  previews = [];
let range = { start: 0, end: 19 },
  edits = 0;
const context = {
  timelineRevision: 0,
  timelineURLs: [],
  timelineGesture: null,
  trimEdits: new Set(),
  source: { animated: true, frameDelays: Array(20).fill(100) },
  importing: false,
  exporting: false,
  playback: {
    editor: { playing: true, frameIndex: 0 },
    preview: { playing: false, frameIndex: 0 },
  },
  $: (id) => elements[id],
  animationRange: () => range,
  fresh: () => ({ trim: false, zoom: 90, stretch: 100, speed: 100 }),
  document: { createElement: () => new Element() },
  URL: {
    createObjectURL: () => `blob:${requests.length}`,
    revokeObjectURL: (url) => revoked.push(url),
  },
  engine: {
    async call(action, args) {
      assert.equal(action, 'previewFrame');
      requests.push(args);
      return { blob: {} };
    },
  },
  beginEdit() {
    edits++;
  },
  stopPlaybackClock: () => 1,
  applyPlayback() {},
  renderPlaybackFrame: (surface, index) => previews.push({ surface, index }),
  commitSliderValue(key, raw) {
    const input = elements[key],
      value = Math.max(Number(input.min), Math.min(Number(input.max), raw));
    range[key === 'start-frame' ? 'start' : 'end'] = value - 1;
    syncInputs();
    context.syncTimeline();
  },
};
function syncInputs() {
  Object.assign(elements['start-frame'], { min: 1, max: range.end, value: range.start + 1 });
  Object.assign(elements['end-frame'], { min: range.start + 2, max: 20, value: range.end + 1 });
}
syncInputs();
vm.createContext(context);
vm.runInContext(
  section('  function syncTimeline()', '  function displayPlaybackFrame(') +
    section('  // Timeline trim handles.', "  $('reset-animation-trim').onclick"),
  context,
);
context.syncTimeline();
assert.equal(elements['frame-timeline'].attributes['--trim-end'], '100%');
assert.equal(elements['trim-start-handle'].attributes['aria-valuenow'], '1');
elements['trim-start-handle'].emit('keydown', { key: 'ArrowRight' });
assert.equal(range.start, 1);
elements['trim-end-handle'].emit('keydown', { key: 'PageDown' });
assert.equal(range.end, 9);
elements['trim-end-handle'].emit('keydown', { key: 'Home' });
assert.equal(range.end, 2, 'Selection retains at least two frames');
range = { start: 0, end: 19 };
syncInputs();
const start = elements['trim-start-handle'];
start.emit('pointerdown', { button: 0, pointerId: 4, clientX: 10 });
assert.equal(context.playback.editor.playing, false);
assert.equal(context.playback.preview.playing, false);
start.emit('pointermove', { pointerId: 4, clientX: 60 });
assert.equal(range.start, 5, 'Drag preserves pointer offset and maps to frame count');
assert.deepEqual(previews.slice(-2), [
  { surface: 'editor', index: 5 },
  { surface: 'preview', index: 5 },
]);
start.emit('pointermove', { pointerId: 4, clientX: 70 });
assert.equal(edits, 1, 'One snapshot per drag');
start.emit('pointercancel', { pointerId: 4 });
assert.equal(context.timelineGesture, null);
assert.equal(context.playback.editor.playing, true);
assert.equal(context.playback.preview.playing, false);
context.importing = true;
start.emit('pointerdown', { button: 0, pointerId: 5, clientX: 10 });
assert.equal(context.timelineGesture, null, 'Import lock blocks handles');
context.importing = false;
await context.buildTimeline();
assert.equal(elements['timeline-frames'].children.length, 10);
assert.deepEqual(
  requests.map((x) => x.index),
  [0, 2, 4, 6, 8, 11, 13, 15, 17, 19],
);
assert(requests.every((x) => x.state.zoom === 100 && !x.state.trim));
assert.equal(elements['timeline-frames'].attributes['aria-busy'], 'false');
context.clearTimeline();
assert.equal(revoked.length, 10);
assert.equal(elements['timeline-frames'].children.length, 0);
let resolve;
context.engine.call = () => new Promise((done) => (resolve = done));
const pending = context.buildTimeline();
context.clearTimeline();
resolve({ blob: {} });
await pending;
assert.equal(
  elements['timeline-frames'].children.length,
  0,
  'Stale thumbnails cannot repopulate after replacement',
);
context.engine.call = async () => {
  throw new Error('Preview failed');
};
await context.buildTimeline();
assert.match(elements['timeline-status'].textContent, /unavailable/);
assert.equal(elements['timeline-frames'].attributes['aria-busy'], 'false');
console.log(
  'Timeline thumbnails, cleanup, keyboard/drag bounds, boundary preview, locks and fallback passed.',
);
