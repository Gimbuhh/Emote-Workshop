// Production handlers with isolated element doubles; no browser UI required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const text = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const first = text.indexOf(start),
    last = text.indexOf(end, first);
  assert(first >= 0 && last > first, 'Slider test anchors missing');
  return text.slice(first, last);
}
class Element {
  get value() {
    return this._value;
  }
  set value(value) {
    this._value = String(value);
  }
  get min() {
    return this._min;
  }
  set min(value) {
    this._min = String(value);
  }
  get max() {
    return this._max;
  }
  set max(value) {
    this._max = String(value);
  }
  get step() {
    return this._step;
  }
  set step(value) {
    this._step = String(value);
  }
  constructor(properties = {}) {
    Object.assign(this, properties);
    this.listeners = {};
  }
  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  dispatchEvent(event) {
    for (const fn of this.listeners[event.type] || []) fn(event);
  }
  select() {
    this.selected = true;
  }
  focus() {
    this.focusValue = this.value;
    this.dispatchEvent(new Event('focus'));
  }
  blur() {
    if (this.value !== this.focusValue) this.dispatchEvent(new Event('change'));
  }
}
const defaults = {
    zoom: 90,
    width: 100,
    stretch: 100,
    speed: 100,
    rotation: 0,
    outline: 0,
    brightness: 100,
  },
  settings = {
    ...defaults,
    x: 0.2,
    y: -0.3,
    flip: true,
    autoFill: false,
    color: '#123456',
  },
  ranges = { twitch: { start: 0, end: 49 }, seventv: { start: 0, end: 99 } },
  elements = {},
  inputs = [],
  buttons = [],
  history = [];
for (const [key, min, max, step, value] of [
  ['zoom', 10, 300, 1, 90],
  ['width', 100, 300, 1, 100],
  ['stretch', 100, 300, 1, 100],
  ['speed', 50, 150, 1, 100],
  ['rotation', -180, 180, 1, 0],
  ['outline', 0, 6, 0.5, 0],
  ['brightness', 50, 150, 1, 100],
  ['start-frame', 1, 49, 1, 1],
  ['end-frame', 2, 100, 1, 50],
]) {
  elements[key] = new Element({
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
  });
  const input = new Element({ value: String(value), dataset: { sliderValue: key } });
  elements[`${key}-value`] = input;
  inputs.push(input);
  buttons.push(new Element({ dataset: { resetSlider: key } }));
}
elements['animation-range-summary'] = new Element();
elements['reset-animation-trim'] = new Element();
const context = {
  Event,
  mode: 'twitch',
  importing: false,
  exporting: false,
  source: { animated: true, frameDelays: Array(100).fill(100) },
  $: (key) => elements[key],
  state: () => settings,
  fresh: () => ({ ...defaults }),
  animationRanges: ranges,
  states: { twitch: settings, seventv: { ...defaults } },
  playbackDelay: (delay, speed = settings.speed) => Math.max(20, (delay * 100) / speed),
  animationRange: () => ranges[context.mode],
  rangeDuration: () => (ranges[context.mode].end - ranges[context.mode].start + 1) * 100,
  beginEdit: () => history.push({ ...settings }),
  schedulePreview() {},
  fillZoom: () => 123,
  syncControls: () => {
    for (const key of Object.keys(defaults)) context.syncSliderValue(key, settings[key]);
  },
  syncTimeline() {},
  document: {
    querySelectorAll: (selector) => (selector === '[data-slider-value]' ? inputs : buttons),
  },
};
vm.createContext(context);
vm.runInContext(
  [
    section('  function syncSliderValue(', '  function syncControls('),
    section('  function clampAnimationRange(', '  function configureAnimation('),
    section('  const trimEdits =', '  // Timeline trim handles.'),
    section("  $('reset-animation-trim').onclick", "  $('outline-color').addEventListener"),
    section('  function normalizeSliderValue(', '  function undo('),
  ].join('\n'),
  context,
);
function type(key, value, cancel = false) {
  const input = elements[`${key}-value`];
  input.focus();
  assert(input.selected);
  input.value = String(value);
  const event = new Event('keydown');
  event.key = cancel ? 'Escape' : 'Enter';
  input.dispatchEvent(event);
}
type('zoom', 96);
assert.equal(settings.zoom, 96);
assert.equal(elements.zoom.value, '96');
assert.equal(history.length, 1);
assert.equal(history[0].zoom, 90);
assert.equal(settings.x, 0.2);
assert.equal(settings.y, -0.3);
type('zoom', 110, true);
assert.equal(settings.zoom, 96);
assert.equal(elements['zoom-value'].value, '96');
assert.equal(history.length, 1, 'Escape does not create an edit');
type('zoom', '');
assert.equal(settings.zoom, 96);
type('zoom', 'invalid');
assert.equal(settings.zoom, 96);
type('zoom', 999);
assert.equal(settings.zoom, 300);
type('zoom', -20);
assert.equal(settings.zoom, 10);
type('outline', 2.7);
assert.equal(settings.outline, 2.5);
type('rotation', -96);
assert.equal(settings.rotation, -96);
type('brightness', 96);
assert.equal(settings.brightness, 96);
settings.zoom = 95.7;
elements.zoom.value = '96';
type('zoom', 96);
assert.equal(settings.zoom, 96, 'Exact entry replaces a fractional fit scale');
type('width', 200);
assert.equal(settings.width, 200);
type('width', 400);
assert.equal(settings.width, 300);
type('width', 50);
assert.equal(settings.width, 100);
type('width', 180);
settings.autoFill = true;
type('width', 200);
assert.equal(settings.zoom, 123, 'Auto-fill updates Scale when Width changes');
settings.autoFill = false;

type('stretch', 145);
assert.equal(settings.stretch, 145);
type('stretch', 400);
assert.equal(settings.stretch, 300);
type('stretch', 50);
assert.equal(settings.stretch, 100);
type('stretch', 150);
type('speed', 75);
assert.equal(settings.speed, 75);
assert.equal(ranges.twitch.end, 49, 'Slowing down keeps the selected frames');
type('speed', 10);
assert.equal(settings.speed, 50);
assert.equal(ranges.twitch.end, 49, 'Longer playback does not trim the range');
type('speed', 300);
assert.equal(settings.speed, 150);
assert.equal(ranges.twitch.end, 49, 'Speed changes never rewrite an intentional trim');
for (const button of buttons.slice(0, 7)) button.dispatchEvent(new Event('click'));
for (const [key, value] of Object.entries(defaults)) assert.equal(settings[key], value);
assert.equal(settings.flip, true);
assert.equal(settings.color, '#123456');
const count = history.length;
buttons[0].dispatchEvent(new Event('click'));
assert.equal(history.length, count, 'Resetting an unchanged value creates no undo entry');
context.importing = true;
type('zoom', 120);
assert.equal(settings.zoom, 90);
context.importing = false;
context.syncAnimationControls();
assert.equal(elements['start-frame-value'].max, '49');
type('start-frame', 3);
assert.equal(ranges.twitch.start, 2);
type('end-frame', 100);
assert.equal(ranges.twitch.end, 99, 'Twitch can select the full animation');
assert.equal(elements['end-frame-value'].value, '100');
context.mode = 'seventv';
context.syncAnimationControls();
type('end-frame', 70);
assert.equal(ranges.seventv.end, 69);
buttons.at(-1).dispatchEvent(new Event('click'));
assert.equal(ranges.seventv.end, 99, '7TV end reset can use the full animation');
assert.equal(ranges.twitch.end, 99, 'Other destination ranges are unchanged');
const undoContext = {
  mode: 'emoji',
  source: { animated: true },
  importing: false,
  exporting: false,
  states: { emoji: { ...defaults } },
  animationRanges: { emoji: { start: 0, end: 49 } },
  history: { emoji: [] },
  future: { emoji: [] },
  clone: (value) => JSON.parse(JSON.stringify(value)),
  syncHistory() {},
  syncControls() {},
  schedulePreview() {},
};
undoContext.state = () => undoContext.states.emoji;
undoContext.animationRange = () => undoContext.animationRanges.emoji;
vm.createContext(undoContext);
vm.runInContext(
  section('  function beginEdit()', '  function syncHistory()') +
    section('  function undo(', "  $('undo').onclick"),
  undoContext,
);
undoContext.beginEdit();
undoContext.states.emoji.speed = 50;
undoContext.animationRanges.emoji.end = 24;
undoContext.undo();
assert.equal(undoContext.states.emoji.speed, 100);
assert.equal(undoContext.animationRanges.emoji.end, 49);
undoContext.undo(true);
assert.equal(undoContext.states.emoji.speed, 50);
assert.equal(undoContext.animationRanges.emoji.end, 24);
context.canvas = new Element();
vm.runInContext(
  section("  bindSliderWheel(canvas, 'zoom');", "  canvas.addEventListener('pointerdown'"),
  context,
);
let wheelTime = 0;
function wheel(deltaY, deltaMode = 0, target = context.canvas, properties = {}) {
  const event = new Event('wheel', { cancelable: true });
  event.deltaY = deltaY;
  event.deltaMode = deltaMode;
  Object.assign(event, properties);
  Object.defineProperty(event, 'timeStamp', { value: (wheelTime += 10) });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}
const loadedSource = context.source;
for (const lock of ['importing', 'exporting', 'source']) {
  context[lock] = lock === 'source' ? null : true;
  const before = history.length;
  assert.equal(wheel(-120), false);
  assert.equal(settings.zoom, 90);
  assert.equal(history.length, before);
  context[lock] = lock === 'source' ? loadedSource : false;
}
assert.equal(wheel(-0.5), true);
assert.equal(settings.zoom, 90);
assert.equal(wheel(-39.5), true);
assert.equal(settings.zoom, 90);
assert.equal(wheel(-39.5), true);
assert.equal(settings.zoom, 90);
assert.equal(wheel(-0.5), true);
assert.equal(settings.zoom, 91);
assert.equal(wheel(-240), true);
assert.equal(settings.zoom, 94, 'Fast precision scrolling applies proportional zoom steps');
assert.equal(wheel(1000), true);
assert.equal(settings.zoom, 90);
assert.equal(wheel(-1, 1), true);
assert.equal(settings.zoom, 91);
assert.equal(settings.x, 0.2);
assert.equal(settings.y, -0.3);

// Every visible slider uses its own native unit and updates the existing edit handlers.
for (const key of Object.keys(defaults)) {
  const before = settings[key],
    step = Number(elements[key].step),
    edits = history.length;
  assert.equal(wheel(-120, 0, elements[key]), true);
  assert.equal(settings[key], before + step, `${key} increases by one step`);
  assert.equal(elements[`${key}-value`].value, String(before + step));
  assert.equal(history.length, edits + 1);
  assert.equal(history.at(-1)[key], before);
  assert.equal(wheel(100, 0, elements[key]), true);
  assert.equal(settings[key], before, `${key} decreases by one step`);
}
for (const [key, raw] of [
  ['zoom', 300],
  ['outline', 6],
  ['rotation', 180],
]) {
  context.commitSliderValue(key, raw);
  const edits = history.length;
  assert.equal(wheel(-120, 0, elements[key]), true);
  assert.equal(settings[key], raw);
  assert.equal(history.length, edits, 'A clamped wheel event creates no undo entry');
  context.commitSliderValue(key, elements[key].min);
  const lowerEdits = history.length;
  assert.equal(wheel(120, 0, elements[key]), true);
  assert.equal(settings[key], Number(elements[key].min));
  assert.equal(history.length, lowerEdits);
}
context.commitSliderValue('zoom', 90);
const zoom = elements.zoom,
  width = elements.width;
assert.equal(wheel(-40, 0, zoom), true);
assert.equal(settings.zoom, 90);
assert.equal(wheel(-40, 0, width), true);
assert.equal(settings.width, 100, 'Trackpad accumulation is isolated per slider');
assert.equal(wheel(-40, 0, zoom), true);
assert.equal(settings.zoom, 91);
assert.equal(wheel(-40, 0, width), true);
assert.equal(settings.width, 101);
wheel(-40, 0, zoom);
wheel(40, 0, zoom);
assert.equal(settings.zoom, 91, 'Reversing direction discards the old remainder');
wheel(40, 0, zoom);
assert.equal(settings.zoom, 90);
wheel(-40, 0, zoom);
wheelTime += 300;
wheel(-40, 0, zoom);
assert.equal(settings.zoom, 90, 'A new gesture starts with a fresh accumulator');
zoom.dispatchEvent(new Event('pointerleave'));
wheel(-40, 0, zoom);
assert.equal(settings.zoom, 90, 'Leaving the bar resets trackpad accumulation');
wheel(-40, 0, zoom);
assert.equal(settings.zoom, 91);
wheel(-240, 0, zoom);
assert.equal(settings.zoom, 94, 'Faster trackpad scrolling applies proportional steps');
wheel(1000, 0, zoom);
assert.equal(settings.zoom, 90, 'A large trackpad event is capped at four steps');
for (const deltaMode of [1, 2]) {
  wheel(-3, deltaMode, zoom);
  assert.equal(settings.zoom, 91, 'Line/page wheel units produce one step');
  wheel(3, deltaMode, zoom);
}
for (const properties of [{ ctrlKey: true }, { metaKey: true }, { deltaX: 240 }]) {
  assert.equal(wheel(-120, 0, zoom, properties), false);
  assert.equal(settings.zoom, 90, 'Modified or horizontal gestures do not adjust the slider');
}
for (const deltaY of [0, NaN, Infinity]) assert.equal(wheel(deltaY, 0, zoom), false);
for (const lock of ['importing', 'exporting', 'source']) {
  context[lock] = lock === 'source' ? null : true;
  const edits = history.length;
  assert.equal(wheel(-120, 0, zoom), false);
  assert.equal(settings.zoom, 90);
  assert.equal(history.length, edits);
  context[lock] = lock === 'source' ? loadedSource : false;
}
zoom.disabled = true;
assert.equal(wheel(-120, 0, zoom), false);
assert.equal(settings.zoom, 90);
zoom.disabled = false;
settings.autoFill = true;
wheel(-120, 0, width);
assert.equal(settings.width, 102);
assert.equal(settings.zoom, 123, 'Wheel Width changes also update auto-fill Scale');
settings.autoFill = false;
const trimEnd = ranges.seventv.end;
wheel(-120, 0, elements.speed);
assert.equal(settings.speed, 101);
assert.equal(ranges.seventv.end, trimEnd, 'Wheel speed changes preserve selected frames');
console.log(
  'Exact slider entry, reset/undo, locks, slider/canvas wheel steps, trackpad gestures, and animation bounds OK',
);
