'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const modes = {
    twitch: {
      label: 'Twitch emote',
      hint: 'Three sizes in one Twitch-ready pack.',
      sizes: [112, 56, 28],
      limit: '100 KB PNG · 512 KB GIF · 60f max',
      export: 'Export Twitch pack',
      channel: 'STREAM CHAT',
    },
    emoji: {
      label: 'Discord emoji',
      hint: 'One file for messages and reactions.',
      sizes: [128],
      limit: 'Under 256 KB',
      export: 'Export emoji',
      channel: '# general',
    },
    seventv: {
      label: '7TV emote',
      hint: 'One upload, up to 1000 × 1000 · 7 MB. 7TV generates the 1×–4× sizes, preserves wide emotes, and may sample long animations.',
      sizes: [1000],
      limit: '7 MB max',
      export: 'Export 7TV emote',
      channel: 'STREAM CHAT',
    },
    sticker: {
      label: 'Discord sticker',
      hint: 'A 320 px sticker with transparent edges.',
      sizes: [320],
      limit: '512 KB max',
      export: 'Export sticker',
      channel: '# stickers',
    },
  };
  const modeMap = (fn) => Object.fromEntries(Object.keys(modes).map((key) => [key, fn(key)]));
  const fresh = () => ({
    zoom: 90,
    width: 100,
    stretch: 100,
    speed: 100,
    x: 0,
    y: 0,
    rotation: 0,
    flip: false,
    trim: false,
    outline: 0,
    color: '#ffffff',
    brightness: 100,
  });
  let mode = 'emoji',
    discordMode = 'emoji',
    theme = 'dark',
    states = modeMap(() => fresh()),
    history = modeMap(() => []),
    future = modeMap(() => []);
  let engine,
    source = null,
    editorImage = null,
    outputs = [],
    outputURLs = [],
    outputMedia = [],
    previewTimer = 0,
    previewRevision = 0,
    busy = false,
    importing = false,
    exporting = false,
    dragGesture = null,
    colorGesture = false,
    toastTimer;
  let animationRanges = modeMap(() => ({ start: 0, end: 1 })),
    animationPlaying = true,
    playbackTimer = 0,
    playbackRevision = 0,
    playbackFrameIndex = 0,
    playbackFrameURL = '',
    editorPlaybackFrameURL = '';
  let timelineRevision = 0,
    timelineURLs = [],
    timelineGesture = null;
  const animationRange = () => animationRanges[mode];
  const state = () => states[mode],
    clone = (value) => JSON.parse(JSON.stringify(value)),
    makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const formatBytes = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1024 * 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / (1024 * 1024)).toFixed(2)} MB`;
  const report = (text, error = false) => {
    $('message').textContent = text;
    $('message').classList.toggle('error', error);
    $('message').hidden = !text;
  };
  function toast(text, error = false) {
    clearTimeout(toastTimer);
    $('toast').textContent = text;
    $('toast').classList.toggle('error', error);
    $('toast').hidden = false;
    toastTimer = setTimeout(() => ($('toast').hidden = true), 4500);
  }
  function showError(text) {
    report(text, true);
    toast(text, true);
  }
  function beginEdit() {
    if (!source || importing || exporting) return;
    history[mode].push({ settings: clone(state()), range: clone(animationRange()) });
    if (history[mode].length > 40) history[mode].shift();
    future[mode] = [];
    syncHistory();
  }
  function syncHistory() {
    $('undo').disabled = !source || !history[mode].length || importing || exporting;
    $('redo').disabled = !source || !future[mode].length || importing || exporting;
  }
  function setEnabled() {
    const locked = importing || exporting;
    $('framing').disabled = !source || locked;
    $('finish').disabled = !source || locked;
    $('animation-trim').disabled = !source || !source.animated || locked;
    for (const id of ['trim-start-handle', 'trim-end-handle'])
      $(id).disabled = !source?.animated || locked;
    for (const id of ['import-top', 'replace', 'empty-import']) $(id).disabled = locked || !engine;
    $('sample').disabled = locked || !engine || !window.EMOTE_SAMPLE;
    for (const id of [
      'platform-twitch',
      'platform-discord',
      'platform-seventv',
      'type-emoji',
      'type-sticker',
      'emote-name',
    ])
      $(id).disabled = locked;
    $('export-current').disabled = !source || !outputs.length || busy || locked;
    $('export-all').disabled = !source || busy || locked;
    $('editor-canvas').setAttribute('aria-disabled', String(!source || locked));
    syncFramingHints();
    syncHistory();
  }
  function effectiveBounds(s) {
    return s.trim && source
      ? source.bounds
      : { w: editorImage?.width || 1, h: editorImage?.height || 1 };
  }
  function hasTransparentMargins() {
    if (!source || !editorImage) return false;
    const b = source.bounds;
    return b.x > 0 || b.y > 0 || b.w < editorImage.width || b.h < editorImage.height;
  }
  function syncFramingHints() {
    const square = mode !== 'seventv',
      canTrim = hasTransparentMargins();
    $('trim').hidden = !canTrim;
    $('trim').disabled = !source || importing || exporting || !canTrim;
    $('trim-hint').textContent =
      source && !canTrim
        ? source.hasTransparency
          ? 'No outer margins to trim. Artwork reaches every edge.'
          : 'No transparent margins found. This source is opaque.'
        : square
          ? 'Center and size using visible artwork.'
          : 'Crop the canvas to visible artwork.';
    $('fill').textContent = 'Fill';
    $('fill').title = square
      ? 'Enlarge without stretching. Artwork beyond the square is cropped.'
      : 'Fill the canvas without changing the artwork’s proportions.';
  }
  function fillZoom(s) {
    const original = effectiveBounds(s),
      b = {
        w: original.w * ((s.width ?? 100) / 100),
        h: original.h * ((s.stretch ?? 100) / 100),
      };
    if (mode === 'seventv') return 100;
    return Math.min(300, (Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h))) * 100);
  }
  function syncSliderValue(key, value) {
    const range = $(key),
      input = $(`${key}-value`);
    input.min = range.min;
    input.max = range.max;
    input.step = range.step;
    input.value = String(value);
  }
  function syncControls() {
    const s = state();
    for (const key of ['zoom', 'width', 'stretch', 'speed', 'rotation', 'outline', 'brightness']) {
      $(key).value = s[key];
      syncSliderValue(key, key === 'zoom' ? Math.round(s[key]) : s[key]);
    }
    $('outline-color').value = s.color;
    $('flip').setAttribute('aria-pressed', String(s.flip));
    $('trim').setAttribute('aria-pressed', String(s.trim));
    $('trim-label').textContent =
      mode === 'seventv' ? 'Trim transparent space' : 'Ignore transparent margins';
    syncFramingHints();
    if (source?.animated) syncAnimationControls();
    syncHistory();
  }
  function uploadSize() {
    const w = source?.workingWidth || source?.width || 1000,
      h = source?.workingHeight || source?.height || 1000,
      b =
        state().trim && source
          ? {
              w: (source.bounds.w * w) / editorImage.width,
              h: (source.bounds.h * h) / editorImage.height,
            }
          : { w, h },
      stretchedWidth = b.w * ((state().width ?? 100) / 100),
      stretchedHeight = b.h * ((state().stretch ?? 100) / 100),
      ratio = Math.min(1, 1000 / Math.max(stretchedWidth, stretchedHeight));
    return {
      width: Math.max(1, Math.round(stretchedWidth * ratio)),
      height: Math.max(1, Math.round(stretchedHeight * ratio)),
    };
  }
  function editorSize() {
    const d = mode === 'seventv' ? uploadSize() : { width: 1, height: 1 },
      ratio = 800 / Math.max(d.width, d.height);
    return {
      width: Math.max(1, Math.round(d.width * ratio)),
      height: Math.max(1, Math.round(d.height * ratio)),
    };
  }
  function drawEditor() {
    const c = $('editor-canvas'),
      d = editorSize();
    c.width = d.width;
    c.height = d.height;
    document.querySelector('.canvas-wrap').style.aspectRatio = `${d.width} / ${d.height}`;
    if (editorImage)
      drawArtwork(
        c.getContext('2d'),
        editorImage,
        state(),
        c.width,
        source.bounds,
        makeCanvas,
        c.height,
      );
  }
  function stopPlaybackClock() {
    clearTimeout(playbackTimer);
    playbackTimer = 0;
    return ++playbackRevision;
  }
  function clearPlaybackFrame() {
    if (playbackFrameURL) URL.revokeObjectURL(playbackFrameURL);
    if (editorPlaybackFrameURL) URL.revokeObjectURL(editorPlaybackFrameURL);
    playbackFrameURL = '';
    editorPlaybackFrameURL = '';
    playbackFrameIndex = animationRange().start;
  }
  function cleanURLs() {
    stopPlaybackClock();
    clearPlaybackFrame();
    for (const url of outputURLs) URL.revokeObjectURL(url);
    outputURLs = [];
    outputMedia = [];
  }
  function expectedFormat() {
    return source?.animated ? (mode === 'sticker' ? 'APNG' : 'GIF') : 'PNG';
  }
  const animationPayload = () =>
    source?.animated ? { start: animationRange().start, end: animationRange().end } : null;
  const playbackDelay = (delay, speed = state().speed ?? 100) =>
    Math.max(20, ((delay || 100) * 100) / speed);
  const rangeDuration = () =>
    source?.frameDelays
      ?.slice(animationRange().start, animationRange().end + 1)
      .reduce((total, delay) => total + playbackDelay(delay), 0) || 0;
  function clampAnimationRange(destination = mode) {
    const total = source?.frameDelays?.length || 0;
    if (total < 2) return;
    const range = animationRanges[destination];
    range.start = Math.max(0, Math.min(total - 2, range.start));
    range.end = Math.max(range.start + 1, Math.min(total - 1, range.end));
    const duration = () =>
      source.frameDelays
        .slice(range.start, range.end + 1)
        .reduce((sum, delay) => sum + playbackDelay(delay, states[destination].speed ?? 100), 0);
    while (destination !== 'seventv' && duration() > 5000 && range.end > range.start + 1)
      range.end--;
  }
  function syncAnimationControls() {
    const total = source?.frameDelays?.length || 2;
    clampAnimationRange();
    $('start-frame').min = 1;
    $('start-frame').max = Math.max(1, animationRange().end);
    $('start-frame').value = animationRange().start + 1;
    $('end-frame').min = Math.min(total, animationRange().start + 2);
    $('end-frame').max = total;
    $('end-frame').value = animationRange().end + 1;
    syncSliderValue('start-frame', animationRange().start + 1);
    syncSliderValue('end-frame', animationRange().end + 1);
    const duration = rangeDuration();
    $('animation-range-summary').textContent =
      `Frames ${animationRange().start + 1}–${animationRange().end + 1} · ${(duration / 1000).toFixed(1)} s · ${mode === 'seventv' ? 'long animations may be sampled' : '5 s max'}`;
    syncTimeline();
  }
  function configureAnimation() {
    const animated = Boolean(source?.animated);
    $('animation-section').hidden = !animated;
    if (!animated) return;
    const total = Math.max(2, source.frameDelays.length);
    animationRanges = modeMap(() => ({ start: 0, end: total - 1 }));
    for (const destination of Object.keys(modes)) clampAnimationRange(destination);
    syncAnimationControls();
  }
  function syncTimeline() {
    const total = source?.frameDelays?.length || 2,
      range = animationRange(),
      left = (range.start / total) * 100,
      right = ((range.end + 1) / total) * 100;
    $('frame-timeline').style.setProperty('--trim-start', `${left}%`);
    $('frame-timeline').style.setProperty('--trim-end', `${right}%`);
    for (const [id, key] of [
      ['trim-start-handle', 'start-frame'],
      ['trim-end-handle', 'end-frame'],
    ]) {
      const handle = $(id),
        input = $(key);
      handle.setAttribute('aria-valuemin', input.min);
      handle.setAttribute('aria-valuemax', input.max);
      handle.setAttribute('aria-valuenow', input.value);
      handle.setAttribute('aria-valuetext', `Frame ${input.value} of ${total}`);
    }
  }
  function clearTimeline() {
    if (timelineGesture) {
      animationPlaying = timelineGesture.playing;
      trimEdits.delete(timelineGesture.key);
      timelineGesture = null;
    }
    timelineRevision++;
    for (const url of timelineURLs) URL.revokeObjectURL(url);
    timelineURLs = [];
    $('timeline-frames').replaceChildren();
  }
  async function buildTimeline() {
    clearTimeline();
    if (!source?.animated) return;
    const revision = timelineRevision,
      total = source.frameDelays.length,
      count = Math.min(10, total),
      strip = $('timeline-frames');
    $('timeline-status').textContent = 'Loading frame previews…';
    strip.setAttribute('aria-busy', 'true');
    try {
      for (let i = 0; i < count; i++) {
        const index = Math.round((i * (total - 1)) / Math.max(1, count - 1)),
          result = await engine.call('previewFrame', {
            index,
            state: { ...fresh(), zoom: 100 },
            size: 96,
            height: 96,
          });
        if (revision !== timelineRevision) return;
        const url = URL.createObjectURL(result.blob),
          img = document.createElement('img');
        timelineURLs.push(url);
        img.src = url;
        img.alt = '';
        img.draggable = false;
        strip.append(img);
      }
      $('timeline-status').textContent = 'Drag the handles to trim. Arrow keys adjust one frame.';
    } catch {
      if (revision === timelineRevision)
        $('timeline-status').textContent =
          'Frame previews unavailable. Handles and frame numbers still work.';
    } finally {
      if (revision === timelineRevision) strip.setAttribute('aria-busy', 'false');
    }
  }
  function displayPlaybackFrame(blob, index, editorBlob) {
    const url = URL.createObjectURL(blob),
      editorURL = URL.createObjectURL(editorBlob);
    if (playbackFrameURL) URL.revokeObjectURL(playbackFrameURL);
    if (editorPlaybackFrameURL) URL.revokeObjectURL(editorPlaybackFrameURL);
    playbackFrameURL = url;
    editorPlaybackFrameURL = editorURL;
    playbackFrameIndex = index;
    for (const img of document.querySelectorAll('[data-animated-url]')) {
      img.src = img.id === 'animated-canvas-preview' ? editorURL : url;
      img.dataset.frameIndex = String(index);
    }
    $('animated-canvas-preview').hidden = false;
    $('editor-canvas').classList.add('playback-hidden');
  }
  async function renderPlaybackFrame(index, token) {
    const destination = mode,
      rev = previewRevision;
    try {
      const settings = clone(state()),
        d = editorSize(),
        output =
          destination === 'seventv'
            ? uploadSize()
            : { width: modes[destination].sizes[0], height: modes[destination].sizes[0] },
        [result, editorResult] = await Promise.all([
          engine.call('previewFrame', {
            index,
            state: settings,
            size: output.width,
            height: output.height,
          }),
          engine.call('previewFrame', {
            index,
            state: settings,
            size: d.width,
            height: d.height,
          }),
        ]);
      if (token !== playbackRevision || rev !== previewRevision || destination !== mode) return;
      displayPlaybackFrame(result.blob, result.index, editorResult.blob);
      if (!animationPlaying) return;
      const next = result.index >= animationRange().end ? animationRange().start : result.index + 1,
        delay = playbackDelay(source.frameDelays[result.index]);
      playbackTimer = setTimeout(() => renderPlaybackFrame(next, token), delay);
    } catch (error) {
      if (token === playbackRevision) {
        animationPlaying = false;
        applyPlayback();
        report(`Preview playback stopped: ${error.message}`, true);
      }
    }
  }
  function startPlayback(restart = false) {
    const token = stopPlaybackClock();
    if (
      restart ||
      !playbackFrameURL ||
      playbackFrameIndex < animationRange().start ||
      playbackFrameIndex > animationRange().end
    ) {
      playbackFrameIndex = animationRange().start;
      renderPlaybackFrame(playbackFrameIndex, token);
      return;
    }
    const next =
        playbackFrameIndex >= animationRange().end
          ? animationRange().start
          : playbackFrameIndex + 1,
      delay = playbackDelay(source.frameDelays[playbackFrameIndex]);
    playbackTimer = setTimeout(() => renderPlaybackFrame(next, token), delay);
  }
  function applyPlayback(restart = false) {
    const active = Boolean(source?.animated && outputMedia.length),
      action = animationPlaying ? 'Pause' : 'Play';
    for (const id of ['editor-animation-toggle', 'animation-toggle']) {
      const control = $(id);
      control.hidden = !active;
      control.setAttribute('aria-pressed', String(animationPlaying));
      control.setAttribute('aria-label', `${action} animated preview`);
      control.removeAttribute('title');
      control.querySelector('use').setAttribute('href', animationPlaying ? '#i-pause' : '#i-play');
      control.querySelector('span').textContent = action;
    }
    const animatedCanvas = $('animated-canvas-preview'),
      editorCanvas = $('editor-canvas');
    if (!active) {
      stopPlaybackClock();
      animatedCanvas.hidden = true;
      animatedCanvas.removeAttribute('src');
      editorCanvas.classList.remove('playback-hidden');
      return;
    }
    const media = outputMedia[0];
    animatedCanvas.dataset.animatedUrl = media.url;
    animatedCanvas.dataset.posterUrl = media.posterUrl;
    if (editorPlaybackFrameURL) animatedCanvas.src = editorPlaybackFrameURL;
    else animatedCanvas.removeAttribute('src');
    animatedCanvas.hidden = !editorPlaybackFrameURL;
    editorCanvas.classList.toggle('playback-hidden', Boolean(editorPlaybackFrameURL));
    if (animationPlaying) startPlayback(restart);
    else {
      const token = stopPlaybackClock();
      if (restart || !editorPlaybackFrameURL) renderPlaybackFrame(playbackFrameIndex, token);
    }
  }
  function populateOutputs(items = []) {
    cleanURLs();
    const list = $('output-list');
    list.replaceChildren();
    for (const size of mode === 'seventv'
      ? [items[0]?.size || uploadSize().width]
      : modes[mode].sizes) {
      const item = items.find((o) => o.size === size),
        row = document.createElement('div');
      row.className = 'output-row';
      const thumb = document.createElement('span');
      thumb.className = 'output-thumb';
      if (item) {
        const url = URL.createObjectURL(item.blob),
          posterUrl = item.poster ? URL.createObjectURL(item.poster) : url;
        outputURLs.push(url);
        if (posterUrl !== url) outputURLs.push(posterUrl);
        const media = { size, url, posterUrl };
        outputMedia.push(media);
        const img = new Image();
        img.alt = `${size} pixel export preview`;
        if (source?.animated) {
          img.dataset.animatedUrl = url;
          img.dataset.posterUrl = posterUrl;
        }
        img.src = source?.animated ? posterUrl : url;
        thumb.append(img);
      } else {
        const label = document.createElement('span');
        label.textContent = '—';
        label.style.color = '#777b84';
        thumb.append(label);
      }
      const meta = document.createElement('div');
      meta.className = 'output-meta';
      const title = document.createElement('strong');
      title.textContent = `${item?.width || size} × ${item?.height || (mode === 'seventv' ? uploadSize().height : size)}`;
      const subtitle = document.createElement('span');
      subtitle.textContent = `${item?.format || expectedFormat()} · ${modes[mode].limit}${item?.frames > 1 ? ` · ${item.frames}f` : ''}`;
      meta.append(title, subtitle);
      const fileSize = document.createElement('span');
      fileSize.className = `output-size${item ? '' : ' waiting'}`;
      fileSize.textContent = item ? `${formatBytes(item.bytes)} ✓` : '—';
      row.append(thumb, meta, fileSize);
      list.append(row);
    }
    const media = outputMedia[mode === 'twitch' ? outputMedia.length - 1 : 0];
    for (const img of document.querySelectorAll('.emote-preview')) {
      img.style.width =
        mode === 'seventv'
          ? `${(32 * (items[0]?.width || uploadSize().width)) / (items[0]?.height || uploadSize().height)}px`
          : '';
      if (media) {
        if (source?.animated) {
          img.dataset.animatedUrl = media.url;
          img.dataset.posterUrl = media.posterUrl;
        } else {
          delete img.dataset.animatedUrl;
          delete img.dataset.posterUrl;
        }
        img.src = source?.animated ? media.posterUrl : media.url;
        img.hidden = false;
      } else {
        img.removeAttribute('src');
        delete img.dataset.animatedUrl;
        delete img.dataset.posterUrl;
        delete img.dataset.frameIndex;
        img.hidden = true;
      }
    }
    $('preview-placeholder').hidden = Boolean(media);
    $('reaction').hidden = mode !== 'emoji' || !media;
    applyPlayback(true);
  }
  function invalidate() {
    ++previewRevision;
    clearTimeout(previewTimer);
    stopPlaybackClock();
    clearPlaybackFrame();
    outputs = [];
    busy = Boolean(source);
    $('export-status').textContent = source ? 'Preparing export…' : 'Waiting for an image';
    $('animation-toggle').hidden = true;
    $('editor-animation-toggle').hidden = true;
    $('animated-canvas-preview').hidden = true;
    $('animated-canvas-preview').removeAttribute('src');
    $('editor-canvas').classList.remove('playback-hidden');
    setEnabled();
  }
  function schedulePreview() {
    drawEditor();
    invalidate();
    if (source) previewTimer = setTimeout(renderPreview, source.animated ? 280 : 140);
  }
  async function renderPreview() {
    clearTimeout(previewTimer);
    const rev = previewRevision,
      destination = mode;
    try {
      const result = await engine.call('render', {
        mode: destination,
        state: clone(state()),
        range: animationPayload(),
      });
      if (rev !== previewRevision || destination !== mode) return;
      outputs = result;
      populateOutputs(result);
      $('export-status').textContent = 'All files checked';
      $('canvas-format').textContent = source.animated
        ? mode === 'sticker'
          ? 'ANIMATED APNG'
          : 'ANIMATED GIF'
        : 'PNG · TRANSPARENT';
      busy = false;
      report('');
      setEnabled();
    } catch (error) {
      if (rev !== previewRevision) return;
      busy = false;
      outputs = [];
      populateOutputs();
      report(error.message, true);
      $('export-status').textContent = 'Export unavailable';
      setEnabled();
    }
  }
  function updateChat() {
    $('chat').className =
      `chat ${mode === 'twitch' || mode === 'seventv' ? 'twitch' : 'discord'} ${mode === 'seventv' ? 'seventv' : ''} ${mode === 'sticker' ? 'sticker' : ''} ${theme}`;
    $('theme-dark').setAttribute('aria-pressed', String(theme === 'dark'));
    $('theme-light').setAttribute('aria-pressed', String(theme === 'light'));
    $('chat-channel').textContent = modes[mode].channel;
    $('preview-caption').textContent =
      `${mode === 'sticker' ? '160 px sticker' : mode === 'emoji' ? 'Message + reaction' : mode === 'seventv' ? '32 px high 7TV emote' : '28 px emote'} preview · ${theme} background`;
    $('chat-line-one').textContent =
      mode === 'sticker' ? 'new sticker just dropped' : 'this is the one';
    $('reaction').hidden = mode !== 'emoji' || !outputs.length;
  }
  function selectMode(next) {
    if (!Object.hasOwn(modes, next) || importing || exporting) return;
    mode = next;
    if (next === 'emoji' || next === 'sticker') discordMode = next;
    document.documentElement.dataset.platform =
      mode === 'seventv' ? 'seventv' : mode === 'twitch' ? 'twitch' : 'discord';
    $('platform-twitch').setAttribute('aria-pressed', String(mode === 'twitch'));
    $('platform-discord').setAttribute(
      'aria-pressed',
      String(mode === 'emoji' || mode === 'sticker'),
    );
    $('platform-seventv').setAttribute('aria-pressed', String(mode === 'seventv'));
    $('discord-types').hidden = mode !== 'emoji' && mode !== 'sticker';
    $('type-emoji').setAttribute('aria-pressed', String(mode === 'emoji'));
    $('type-sticker').setAttribute('aria-pressed', String(mode === 'sticker'));
    $('destination-hint').textContent = modes[mode].hint;
    $('export-label').textContent = modes[mode].export;
    $('canvas-title').textContent = source ? modes[mode].label : 'Canvas';
    syncControls();
    syncAnimationControls();
    invalidate();
    populateOutputs();
    updateChat();
    drawEditor();
    if (source) renderPreview();
  }
  async function importImage(file) {
    if (!file || importing || exporting || !engine) return;
    importing = true;
    clearTimeline();
    invalidate();
    setEnabled();
    report('');
    $('loading').hidden = false;
    $('drop-zone').setAttribute('aria-busy', 'true');
    $('loading-label').textContent =
      file.type === 'video/mp4' || /\.mp4$/i.test(file.name || '')
        ? 'Converting MP4 frames…'
        : 'Opening media…';
    try {
      const loaded = await engine.call('load', { file }),
        preview = await createImageBitmap(loaded.preview);
      if (editorImage) editorImage.close();
      editorImage = preview;
      source = loaded;
      animationPlaying = true;
      states = modeMap(() => fresh());
      history = modeMap(() => []);
      future = modeMap(() => []);
      configureAnimation();
      $('source-name').textContent = file.name || 'pasted-media';
      const sampled =
        loaded.originalFrames > loaded.decodedFrames
          ? ` sampled from ${loaded.originalFrames}`
          : '';
      const animation = loaded.animated
        ? ` · ${loaded.frames} frames${sampled} · ${(loaded.duration / 1000).toFixed(1)} s`
        : '';
      $('source-details').textContent =
        `${loaded.width.toLocaleString()} × ${loaded.height.toLocaleString()} · ${formatBytes(loaded.bytes)} · ${loaded.type}${animation}`;
      const name = (file.name || 'my_emote')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-z0-9_]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
      $('emote-name').value = name.length >= 2 ? name : 'my_emote';
      $('editor-canvas').hidden = false;
      $('empty-import').hidden = true;
      $('replace').hidden = false;
      $('canvas-instruction').textContent =
        'Drag to reposition · Scroll to zoom 1% · Guides appear at center';
      $('canvas-title').textContent = modes[mode].label;
      $('canvas-format').textContent = loaded.animated ? 'ANIMATED SOURCE' : 'PNG · TRANSPARENT';
      syncControls();
      drawEditor();
      toast(
        loaded.sampled
          ? `${loaded.type} ready. Using ${loaded.decodedFrames} optimized frames.`
          : 'Media ready.',
      );
    } catch (error) {
      showError(error.message);
    } finally {
      importing = false;
      $('loading').hidden = true;
      $('drop-zone').setAttribute('aria-busy', 'false');
      setEnabled();
      if (source) {
        buildTimeline();
        invalidate();
        await renderPreview();
      } else {
        busy = false;
        setEnabled();
      }
    }
  }
  for (const id of ['import-top', 'empty-import', 'replace'])
    $(id).addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    importImage(e.target.files[0]);
    e.target.value = '';
  });
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    $('drop-zone').classList.add('dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      $('drop-zone').classList.remove('dragging');
    }
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('drop-zone').classList.remove('dragging');
    const files = [...e.dataTransfer.files];
    if (files.length) {
      importImage(files[0]);
      if (files.length > 1) toast('Opened the first file.');
    } else showError('Unsupported file. Use PNG, JPG, GIF, WebP, AVIF, or MP4.');
  });
  document.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.items || [])]
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (file) {
      e.preventDefault();
      importImage(file);
    }
  });
  $('platform-twitch').onclick = () => selectMode('twitch');
  $('platform-discord').onclick = () => selectMode(discordMode);
  $('platform-seventv').onclick = () => selectMode('seventv');
  $('type-emoji').onclick = () => selectMode('emoji');
  $('type-sticker').onclick = () => selectMode('sticker');
  $('theme-dark').onclick = () => {
    theme = 'dark';
    updateChat();
  };
  $('theme-light').onclick = () => {
    theme = 'light';
    updateChat();
  };
  for (const id of ['editor-animation-toggle', 'animation-toggle'])
    $(id).onclick = () => {
      animationPlaying = !animationPlaying;
      applyPlayback();
    };
  const trimEdits = new Set();
  for (const key of ['start-frame', 'end-frame']) {
    $(key).addEventListener('input', () => {
      if (!source?.animated || importing || exporting || trimEdits.has(key)) return;
      beginEdit();
      trimEdits.add(key);
    });
    $(key).addEventListener('change', () => trimEdits.delete(key));
  }
  $('start-frame').addEventListener('input', () => {
    if (!source?.animated || importing || exporting) return;
    animationRange().start = Math.min(Number($('start-frame').value) - 1, animationRange().end - 1);
    clampAnimationRange();
    syncAnimationControls();
    schedulePreview();
  });
  $('end-frame').addEventListener('input', () => {
    if (!source?.animated || importing || exporting) return;
    animationRange().end = Math.max(Number($('end-frame').value) - 1, animationRange().start + 1);
    clampAnimationRange();
    syncAnimationControls();
    schedulePreview();
  });
  // Timeline trim handles.
  for (const [id, key] of [
    ['trim-start-handle', 'start-frame'],
    ['trim-end-handle', 'end-frame'],
  ]) {
    const handle = $(id);
    const update = (value, preview = false) => {
      commitSliderValue(key, value);
      if (preview) {
        playbackFrameIndex = key === 'start-frame' ? animationRange().start : animationRange().end;
        renderPlaybackFrame(playbackFrameIndex, stopPlaybackClock());
      }
    };
    handle.addEventListener('keydown', (e) => {
      const current = Number($(key).value),
        jumps = {
          ArrowLeft: -1,
          ArrowDown: -1,
          ArrowRight: 1,
          ArrowUp: 1,
          PageDown: -10,
          PageUp: 10,
        };
      if (Object.hasOwn(jumps, e.key)) {
        e.preventDefault();
        update(current + jumps[e.key]);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        update(Number($(key)[e.key === 'Home' ? 'min' : 'max']));
      }
    });
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !source?.animated || importing || exporting || timelineGesture) return;
      const rect = $('frame-timeline').getBoundingClientRect();
      e.preventDefault();
      handle.focus();
      handle.setPointerCapture(e.pointerId);
      beginEdit();
      trimEdits.add(key);
      timelineGesture = {
        pointer: e.pointerId,
        key,
        x: e.clientX,
        width: rect.width,
        value: Number($(key).value),
        playing: animationPlaying,
      };
      animationPlaying = false;
      stopPlaybackClock();
    });
    handle.addEventListener('pointermove', (e) => {
      const gesture = timelineGesture;
      if (
        !gesture ||
        gesture.pointer !== e.pointerId ||
        gesture.key !== key ||
        importing ||
        exporting
      )
        return;
      const total = source.frameDelays.length;
      const value = gesture.value + Math.round(((e.clientX - gesture.x) / gesture.width) * total);
      // Keep the entire gesture as one undo entry, including exact-entry dispatches.
      trimEdits.add(key);
      update(value, true);
    });
    const finish = (e) => {
      if (
        !timelineGesture ||
        timelineGesture.pointer !== e.pointerId ||
        timelineGesture.key !== key
      )
        return;
      animationPlaying = timelineGesture.playing;
      timelineGesture = null;
      trimEdits.delete(key);
      applyPlayback();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  }
  $('reset-animation-trim').onclick = () => {
    if (!source?.animated || importing || exporting) return;
    beginEdit();
    animationRanges[mode] = { start: 0, end: source.frameDelays.length - 1 };
    clampAnimationRange();
    syncAnimationControls();
    schedulePreview();
  };
  for (const key of ['zoom', 'width', 'stretch', 'speed', 'rotation', 'outline', 'brightness']) {
    let started = false;
    $(key).addEventListener('dragstart', (e) => e.preventDefault());
    $(key).addEventListener('input', () => {
      if (!started) {
        beginEdit();
        started = true;
      }
      state()[key] = Number($(key).value);
      syncControls();
      schedulePreview();
    });
    $(key).addEventListener('change', () => {
      started = false;
    });
  }
  $('outline-color').addEventListener('input', () => {
    if (!colorGesture) {
      beginEdit();
      colorGesture = true;
    }
    state().color = $('outline-color').value;
    schedulePreview();
  });
  $('outline-color').addEventListener('change', () => {
    colorGesture = false;
  });
  const change = (fn) => {
    if (!source || importing || exporting) return;
    beginEdit();
    fn(state());
    syncControls();
    schedulePreview();
  };
  $('fit').onclick = () =>
    change((s) => {
      s.zoom = 90;
      s.x = 0;
      s.y = 0;
    });
  $('fill').onclick = () =>
    change((s) => {
      s.zoom = fillZoom(s);
      s.x = 0;
      s.y = 0;
    });
  $('trim').onclick = () => {
    if (!hasTransparentMargins()) return;
    change((s) => {
      const before = effectiveBounds(s);
      s.trim = !s.trim;
      const after = effectiveBounds(s);
      const width = (s.width ?? 100) / 100,
        stretch = s.stretch / 100;
      s.zoom = Math.max(
        10,
        Math.min(
          300,
          (s.zoom * Math.max(after.w * width, after.h * stretch)) /
            Math.max(before.w * width, before.h * stretch),
        ),
      );
      s.x = 0;
      s.y = 0;
    });
  };
  $('flip').onclick = () =>
    change((s) => {
      s.flip = !s.flip;
    });
  $('center').onclick = () =>
    change((s) => {
      s.x = 0;
      s.y = 0;
    });
  function normalizeSliderValue(raw, range) {
    if (String(raw).trim() === '') return null;
    const value = Number(raw),
      min = Number(range.min),
      max = Number(range.max),
      step = Number(range.step) || 1;
    if (!Number.isFinite(value)) return null;
    const clamped = Math.max(min, Math.min(max, value));
    return Math.max(
      min,
      Math.min(max, Number((min + Math.round((clamped - min) / step) * step).toFixed(10))),
    );
  }
  function commitSliderValue(key, raw) {
    if (!source || importing || exporting) return;
    if (key === 'speed' && !source.animated) return;
    if ((key === 'start-frame' || key === 'end-frame') && !source.animated) return;
    const range = $(key),
      value = normalizeSliderValue(raw, range),
      current = Object.hasOwn(state(), key) ? state()[key] : Number(range.value);
    if (value !== null && value !== current) {
      range.value = String(value);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      range.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncSliderValue(key, range.value);
  }
  for (const input of document.querySelectorAll('[data-slider-value]')) {
    const key = input.dataset.sliderValue;
    let originalValue;
    input.addEventListener('focus', () => {
      originalValue = input.value;
      input.select();
    });
    input.addEventListener('change', () => commitSliderValue(key, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      if (e.key === 'Escape') input.value = originalValue;
      else commitSliderValue(key, input.value);
      input.blur();
    });
  }
  for (const button of document.querySelectorAll('[data-reset-slider]')) {
    const key = button.dataset.resetSlider;
    button.addEventListener('click', () => {
      const value =
        key === 'start-frame'
          ? 1
          : key === 'end-frame'
            ? source?.frameDelays?.length || 2
            : fresh()[key];
      commitSliderValue(key, value);
    });
  }
  function undo(redo = false) {
    if (!source || importing || exporting) return;
    const from = redo ? future[mode] : history[mode],
      to = redo ? history[mode] : future[mode];
    if (!from.length) return;
    to.push({ settings: clone(state()), range: clone(animationRange()) });
    const previous = from.pop();
    states[mode] = previous.settings;
    animationRanges[mode] = previous.range;
    syncControls();
    schedulePreview();
  }
  $('undo').onclick = () => undo();
  $('redo').onclick = () => undo(true);
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo(e.shiftKey);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      undo(true);
    }
  });
  const canvas = $('editor-canvas'),
    guides = $('alignment-guides');
  const wheelPixelThreshold = 40,
    wheelGestureGap = 250;
  let wheelPixels = 0,
    wheelDirection = 0,
    wheelTime = 0;
  function showGuides(x, y) {
    guides.classList.toggle('show-x', x);
    guides.classList.toggle('show-y', y);
  }
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (
        !source ||
        importing ||
        exporting ||
        e.ctrlKey ||
        e.metaKey ||
        !Number.isFinite(e.deltaY) ||
        !e.deltaY
      ) {
        wheelPixels = 0;
        wheelDirection = 0;
        return;
      }
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      if (direction !== wheelDirection || e.timeStamp - wheelTime > wheelGestureGap) {
        wheelPixels = 0;
      }
      wheelDirection = direction;
      wheelTime = e.timeStamp;
      wheelPixels +=
        (e.deltaMode || 0) === 0
          ? Math.min(Math.abs(e.deltaY), wheelPixelThreshold)
          : wheelPixelThreshold;
      if (wheelPixels < wheelPixelThreshold) return;
      wheelPixels -= wheelPixelThreshold;
      commitSliderValue('zoom', Number($('zoom').value) + direction);
    },
    { passive: false },
  );
  canvas.addEventListener('pointerdown', (e) => {
    if (!source || importing || exporting || e.button !== 0) return;
    e.preventDefault();
    canvas.focus();
    beginEdit();
    const rect = canvas.getBoundingClientRect();
    dragGesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      sx: state().x,
      sy: state().y,
      width: rect.width,
      height: rect.height,
    };
    canvas.setPointerCapture(e.pointerId);
    showGuides(state().x === 0, state().y === 0);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragGesture || dragGesture.id !== e.pointerId) return;
    const thresholdX = 6 / dragGesture.width,
      thresholdY = 6 / dragGesture.height;
    let x = Math.max(
        -2,
        Math.min(2, dragGesture.sx + (e.clientX - dragGesture.x) / dragGesture.width),
      ),
      y = Math.max(
        -2,
        Math.min(2, dragGesture.sy + (e.clientY - dragGesture.y) / dragGesture.height),
      );
    const snapX = Math.abs(x) <= thresholdX,
      snapY = Math.abs(y) <= thresholdY;
    if (snapX) x = 0;
    if (snapY) y = 0;
    state().x = x;
    state().y = y;
    showGuides(snapX, snapY);
    schedulePreview();
  });
  const stopDrag = (e) => {
    if (dragGesture?.id === e.pointerId) {
      dragGesture = null;
      showGuides(false, false);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    }
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('lostpointercapture', () => {
    dragGesture = null;
    showGuides(false, false);
  });
  canvas.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const amount = (e.shiftKey ? 10 : 1) / 320;
    change((s) => {
      if (e.key === 'ArrowLeft') s.x -= amount;
      if (e.key === 'ArrowRight') s.x += amount;
      if (e.key === 'ArrowUp') s.y -= amount;
      if (e.key === 'ArrowDown') s.y += amount;
      s.x = Math.max(-2, Math.min(2, s.x));
      s.y = Math.max(-2, Math.min(2, s.y));
    });
  });
  const safeName = () => {
    const n = $('emote-name').value.trim();
    if (!/^[a-z0-9_]{2,32}$/i.test(n)) {
      report('Use 2–32 letters, numbers, or underscores for the file name.', true);
      $('emote-name').focus();
      return null;
    }
    return n;
  };
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function exportFiles(all = false) {
    const name = safeName();
    if (!name || !source || busy || importing || exporting) return;
    exporting = true;
    setEnabled();
    report('');
    $('export-label').textContent = 'Packing files…';
    try {
      const result = all
        ? await engine.call('all', { states: clone(states), ranges: clone(animationRanges) })
        : { [mode]: outputs };
      if (!all && mode !== 'twitch') {
        const item = outputs[0];
        download(
          item.blob,
          `${name}_${mode}_${mode === 'seventv' ? `${item.width}x${item.height}` : item.size}.${item.extension}`,
        );
      } else {
        const zip = new JSZip();
        for (const [destination, files] of Object.entries(result))
          for (const item of files) {
            const fileName = `${name}_${destination}_${destination === 'seventv' ? `${item.width}x${item.height}` : item.size}.${item.extension}`;
            zip.file(all ? `${destination}/${fileName}` : fileName, await item.blob.arrayBuffer());
          }
        download(
          await zip.generateAsync({ type: 'blob', compression: 'STORE' }),
          `${name}_${all ? 'all_destinations' : 'twitch_pack'}.zip`,
        );
      }
      toast(all ? 'All destinations are ready.' : 'Export ready.');
    } catch (error) {
      report(`Could not export: ${error.message}`, true);
    } finally {
      exporting = false;
      $('export-label').textContent = modes[mode].export;
      setEnabled();
    }
  }
  $('export-current').onclick = () => exportFiles();
  $('export-all').onclick = () => exportFiles(true);
  $('sample').onclick = () => {
    if (!window.EMOTE_SAMPLE) return;
    const raw = atob(window.EMOTE_SAMPLE),
      bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    importImage(new File([bytes], 'GlorpWitch.webp', { type: 'image/webp' }));
  };
  try {
    engine = new EmoteEngine();
  } catch (error) {
    report(error.message, true);
  }
  selectMode(mode);
  setEnabled();
  window.addEventListener('beforeunload', () => {
    cleanURLs();
    if (editorImage) editorImage.close();
    engine?.close();
  });
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController(),
      tools = [
        {
          name: 'read_emote_workshop',
          description:
            'Read the current destination, source details, editing settings, animation range, and validated export sizes.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true },
          execute: () => ({
            mode,
            source: source
              ? {
                  width: source.width,
                  height: source.height,
                  bytes: source.bytes,
                  animated: source.animated,
                  frames: source.frames,
                }
              : null,
            animationRange: source?.animated
              ? {
                  startFrame: animationRange().start + 1,
                  endFrame: animationRange().end + 1,
                  durationMs: rangeDuration(),
                  playing: animationPlaying,
                }
              : null,
            settings: clone(state()),
            outputs: outputs.map(({ size, width, height, bytes, limit, format, frames }) => ({
              size,
              width,
              height,
              bytes,
              limit,
              format,
              frames,
            })),
            busy,
          }),
        },
        {
          name: 'select_emote_destination',
          description:
            'Select Twitch emote, 7TV emote, Discord emoji, or Discord sticker in the editor.',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['twitch', 'emoji', 'sticker', 'seventv'] },
            },
            required: ['mode'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: async (input) => {
            if (
              !input ||
              !Object.hasOwn(modes, input.mode) ||
              Object.keys(input).some((k) => k !== 'mode')
            )
              throw new Error('Choose twitch, emoji, sticker, or seventv.');
            if (importing || exporting)
              throw new Error('Wait for the current operation to finish.');
            selectMode(input.mode);
            return { mode };
          },
        },
      ];
    for (const tool of tools) {
      try {
        Promise.resolve(
          document.modelContext.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }
})();
