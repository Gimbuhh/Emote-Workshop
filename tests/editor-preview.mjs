// Isolate the production preview functions with media/UI doubles; no browser needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sourceText = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const first = sourceText.indexOf(start),
    last = sourceText.indexOf(end, first);
  assert(first >= 0 && last > first, 'Preview test anchors missing');
  return sourceText.slice(first, last);
}
const editor = { id: 'animated-canvas-preview', dataset: {}, hidden: true },
  chat = { id: 'chat', dataset: {} },
  thumbnail = { id: 'thumbnail', dataset: {} },
  canvas = {
    classList: { add() {} },
    getContext() {
      return {};
    },
  },
  wrap = { style: {} },
  requests = [],
  timers = [],
  revoked = [],
  created = [];
const context = {
  mode: 'twitch',
  modes: { twitch: { sizes: [112] }, emoji: { sizes: [128] }, sticker: { sizes: [320] } },
  uploadSize: () => ({ width: 128, height: 128 }),
  state: () => ({ zoom: 90 }),
  clone: (value) => ({ ...value }),
  editorImage: { width: 128, height: 128 },
  source: { bounds: {}, frameDelays: [80, 160] },
  makeCanvas() {},
  drawArtwork() {},
  $: (id) => (id === 'editor-canvas' ? canvas : editor),
  document: {
    querySelector: () => wrap,
    querySelectorAll: (selector) =>
      selector.includes(':not') ? [chat, thumbnail] : [editor, chat, thumbnail],
  },
  URL: {
    createObjectURL(blob) {
      created.push(blob);
      return `blob:${created.length}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  },
  playback: {
    editor: { playing: true, timer: 0, revision: 7, frameIndex: 0, frameURL: '' },
    preview: { playing: true, timer: 0, revision: 7, frameIndex: 0, frameURL: '' },
  },
  previewRevision: 0,
  animationRange: () => ({ start: 0, end: 1 }),
  setTimeout(fn, delay) {
    timers.push({ fn, delay });
    return timers.length;
  },
  report(message) {
    throw new Error(message);
  },
  applyPlayback() {},
  engine: {
    async call(action, args) {
      assert.equal(action, 'previewFrame');
      requests.push(args);
      return { index: args.index, blob: { width: args.size, height: args.height } };
    },
  },
};
vm.createContext(context);
vm.runInContext(
  [
    section('  function editorSize()', '  function stopPlaybackClock('),
    section('  const playbackDelay =', '  const rangeDuration ='),
    section('  function stopPlaybackClock(', '  function cleanURLs()'),
    section('  function displayPlaybackFrame(', '  function startPlayback('),
  ].join('\n'),
  context,
);

for (const [mode, width, height, outputWidth, outputHeight] of [
  ['twitch', 800, 800, 112, 112],
  ['emoji', 800, 800, 128, 128],
  ['sticker', 800, 800, 320, 320],
  ['seventv', 800, 800, 128, 128],
  ['seventv', 800, 394, 260, 128],
]) {
  context.mode = mode;
  context.uploadSize = () => ({ width: outputWidth, height: outputHeight });
  context.drawEditor();
  assert.deepEqual([canvas.width, canvas.height], [width, height]);
  assert.equal(wrap.style.aspectRatio, `${width} / ${height}`);
  requests.length = 0;
  await context.renderPlaybackFrame('preview', 1, 7);
  await context.renderPlaybackFrame('editor', 1, 7);
  assert.deepEqual(
    requests.map(({ size, height }) => [size, height]),
    [
      [outputWidth, outputHeight],
      [width, height],
    ],
  );
  assert(
    requests.every(({ index }) => index === 1),
    'Editor/chat show the same frame',
  );
  assert.equal(editor.src, context.playback.editor.frameURL);
  assert.equal(chat.src, context.playback.preview.frameURL);
  assert.equal(thumbnail.src, chat.src);
  assert.notEqual(editor.src, chat.src);
  assert.equal(editor.hidden, false);
}
assert(revoked.length >= 8, 'Superseded editor and destination URLs are released');
const timerCount = timers.length;
context.state = () => ({ zoom: 90, speed: 50 });
await context.renderPlaybackFrame('preview', 0, 7);
assert.equal(timers.at(-1).delay, 160, 'Half speed doubles preview delays');
context.state = () => ({ zoom: 90, speed: 150 });
await context.renderPlaybackFrame('preview', 0, 7);
assert.equal(timers.at(-1).delay, 80 / 1.5, 'Fast preview timing follows speed');
context.state = () => ({ zoom: 90 });
context.playback.preview.playing = false;
await context.renderPlaybackFrame('preview', 0, 7);
assert.equal(
  timers.length,
  timerCount + 2,
  'A paused first frame renders without starting playback',
);
assert.equal(chat.dataset.frameIndex, '0');
const urlCount = created.length;
await context.renderPlaybackFrame('preview', 1, 6);
assert.equal(created.length, urlCount, 'Stale playback results are discarded');
const lastURLs = [context.playback.preview.frameURL, context.playback.editor.frameURL];
context.clearPlaybackFrames();
assert(lastURLs.every((url) => revoked.includes(url)));
assert.equal(context.playback.preview.frameURL, '');
assert.equal(context.playback.editor.frameURL, '');
console.log(
  'Consistent still/animated editor resolution, destination previews, pause, and URL cleanup OK',
);
