'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const modes = {
    twitch: {
      label: 'Twitch emote',
      hint: '112, 56, and 28 px · PNG or GIF',
      sizes: [112, 56, 28],
      limit: '100 KB PNG · 512 KB GIF · 60f max',
      export: 'Export Twitch pack',
      channel: 'STREAM CHAT',
    },
    emoji: {
      label: 'Discord emoji',
      hint: '128 × 128 px · PNG or GIF · Under 256 KB',
      sizes: [128],
      limit: 'Under 256 KB',
      export: 'Export emoji',
      channel: '# general',
    },
    seventv: {
      label: '7TV emote',
      hint: 'Up to 1000 px · 7 MB · Below 3:1',
      sizes: [1000],
      limit: '7 MB max',
      export: 'Export 7TV emote',
      channel: 'STREAM CHAT',
    },
    sticker: {
      label: 'Discord sticker',
      hint: '320 × 320 px · PNG or APNG · 512 KB',
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
    autoFill: false,
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
    toastTimer,
    compareMode = false,
    comparePlaybackRevision = 0,
    originalFrameURL = '';
  let animationRanges = modeMap(() => ({ start: 0, end: 1 }));
  const playback = {
    editor: { playing: true, timer: 0, revision: 0, frameIndex: 0, frameURL: '' },
    preview: { playing: true, timer: 0, revision: 0, frameIndex: 0, frameURL: '' },
  };
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
    for (const id of ['trim-range', 'trim-start-handle', 'trim-end-handle'])
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
    $('compare-toggle').disabled = !source || !outputs.length || busy || locked;
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
    $('auto-fill').setAttribute('aria-pressed', String(s.autoFill));
    $('trim-label').textContent =
      mode === 'seventv' ? 'Trim transparent space' : 'Ignore transparent margins';
    syncFramingHints();
    if (source?.animated) syncAnimationControls();
    syncHistory();
  }
  function limitAspectRatio(width, height) {
    const roundedWidth = Math.max(1, Math.round(width)),
      roundedHeight = Math.max(1, Math.round(height));
    if (roundedWidth >= roundedHeight * 3)
      return { width: roundedHeight * 3 - 1, height: roundedHeight };
    if (roundedHeight >= roundedWidth * 3)
      return { width: roundedWidth, height: roundedWidth * 3 - 1 };
    return { width: roundedWidth, height: roundedHeight };
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
    return limitAspectRatio(stretchedWidth * ratio, stretchedHeight * ratio);
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
    $('editor-wrap').style.aspectRatio = `${d.width} / ${d.height}`;
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
    drawOriginalCompare();
  }
  function drawOriginalCompare() {
    const canvas = $('original-compare-canvas'),
      animated = $('original-animated-preview');
    if (!compareMode || !editorImage) {
      canvas.hidden = true;
      animated.hidden = true;
      return;
    }
    const ratio = Math.min(1, 800 / Math.max(editorImage.width, editorImage.height));
    canvas.width = Math.max(1, Math.round(editorImage.width * ratio));
    canvas.height = Math.max(1, Math.round(editorImage.height * ratio));
    canvas.getContext('2d').drawImage(editorImage, 0, 0, canvas.width, canvas.height);
    $('editor-wrap').style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    const animatedFrameReady = Boolean(source?.animated && originalFrameURL);
    canvas.hidden = animatedFrameReady;
    animated.hidden = !animatedFrameReady;
  }
  function stopPlaybackClock(surface) {
    const player = playback[surface];
    clearTimeout(player.timer);
    player.timer = 0;
    return ++player.revision;
  }
  function stopPlaybackClocks() {
    for (const surface of Object.keys(playback)) stopPlaybackClock(surface);
  }
  function clearPlaybackFrame(surface) {
    const player = playback[surface];
    if (player.frameURL) URL.revokeObjectURL(player.frameURL);
    player.frameURL = '';
    player.frameIndex = animationRange().start;
    if (surface === 'editor') {
      if (originalFrameURL) URL.revokeObjectURL(originalFrameURL);
      originalFrameURL = '';
      $('original-animated-preview').removeAttribute('src');
      drawOriginalCompare();
    }
  }
  function clearPlaybackFrames() {
    for (const surface of Object.keys(playback)) clearPlaybackFrame(surface);
  }
  function cleanURLs() {
    stopPlaybackClocks();
    clearPlaybackFrames();
    clearConvertedPreview();
    for (const url of outputURLs) URL.revokeObjectURL(url);
    outputURLs = [];
    outputMedia = [];
  }
  function expectedFormat() {
    return source?.animated ? (mode === 'sticker' ? 'APNG' : 'GIF') : 'PNG';
  }
  function comparisonMedia() {
    return outputMedia[0] || null;
  }
  function clearConvertedPreview() {
    comparePlaybackRevision++;
    const image = $('converted-preview'),
      paused = $('converted-paused'),
      live = $('converted-live-preview');
    image.removeAttribute('src');
    image.hidden = true;
    paused.hidden = true;
    paused.getContext('2d').clearRect(0, 0, paused.width, paused.height);
    if (compareMode && source) {
      const editor = $('editor-canvas');
      live.width = editor.width;
      live.height = editor.height;
      live.getContext('2d').drawImage(editor, 0, 0);
      live.hidden = false;
      $('converted-wrap').style.aspectRatio = `${editor.width} / ${editor.height}`;
    } else live.hidden = true;
    $('compare-converted-meta').textContent = source ? 'Live preview' : 'No export yet';
  }
  function syncConvertedPreview(restart = false) {
    const media = comparisonMedia(),
      pane = $('converted-pane'),
      image = $('converted-preview'),
      paused = $('converted-paused'),
      live = $('converted-live-preview');
    pane.hidden = !compareMode;
    $('compare-original-meta').textContent = source
      ? `${source.type} · ${formatBytes(source.bytes)}`
      : 'Source preview';
    if (!compareMode || !media) {
      clearConvertedPreview();
      return;
    }
    $('converted-wrap').style.aspectRatio = `${media.width} / ${media.height}`;
    live.hidden = true;
    $('compare-converted-meta').textContent =
      `${media.format} · ${formatBytes(media.bytes)}${media.frames > 1 ? ` · ${media.frames}f` : ''}`;
    if (!source.animated) {
      comparePlaybackRevision++;
      paused.hidden = true;
      image.hidden = false;
      if (image.src !== media.url) image.src = media.url;
      return;
    }
    if (!playback.editor.playing) {
      const revision = ++comparePlaybackRevision;
      const width = image.naturalWidth || media.width,
        height = image.naturalHeight || media.height;
      paused.width = width;
      paused.height = height;
      const context = paused.getContext('2d');
      context.clearRect(0, 0, width, height);
      if (image.complete && image.naturalWidth) context.drawImage(image, 0, 0, width, height);
      else {
        const poster = new Image();
        poster.onload = () => {
          if (
            revision === comparePlaybackRevision &&
            compareMode &&
            !playback.editor.playing &&
            comparisonMedia() === media
          )
            context.drawImage(poster, 0, 0, width, height);
        };
        poster.src = media.posterUrl;
      }
      image.hidden = true;
      paused.hidden = false;
      return;
    }
    paused.hidden = true;
    image.hidden = false;
    if (!restart && image.src === media.url) return;
    const revision = ++comparePlaybackRevision;
    image.src = media.posterUrl;
    requestAnimationFrame(() => {
      if (
        revision === comparePlaybackRevision &&
        compareMode &&
        playback.editor.playing &&
        comparisonMedia() === media
      )
        image.src = media.url;
    });
  }
  function setCompareSide(side) {
    const next = side === 'original' ? 'original' : 'converted';
    $('drop-zone').dataset.compareSide = next;
    $('compare-original').setAttribute('aria-pressed', String(next === 'original'));
    $('compare-converted').setAttribute('aria-pressed', String(next === 'converted'));
  }
  function setCompareMode(active) {
    compareMode = Boolean(active && source && outputMedia.length);
    $('compare-toggle').setAttribute('aria-pressed', String(compareMode));
    $('drop-zone').classList.toggle('comparing', compareMode);
    $('converted-pane').hidden = !compareMode;
    drawEditor();
    if (compareMode && source.animated) {
      playback.editor.frameIndex = animationRange().start;
      applyPlayback('editor', true);
    } else syncConvertedPreview(compareMode);
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
  function fitAnimationRangeToLimit(destination = mode) {
    clampAnimationRange(destination);
    if (destination === 'seventv') return;
    const range = animationRanges[destination],
      total = source?.frameDelays?.length || 0,
      speed = states[destination].speed ?? 100;
    let duration = source.frameDelays
      .slice(range.start, range.end + 1)
      .reduce((sum, delay) => sum + playbackDelay(delay, speed), 0);
    while (range.end < total - 1) {
      const nextDelay = playbackDelay(source.frameDelays[range.end + 1], speed);
      if (duration + nextDelay > 5000) break;
      range.end++;
      duration += nextDelay;
    }
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
    const selection = $('trim-range'),
      length = range.end - range.start;
    selection.setAttribute('aria-valuemin', '1');
    selection.setAttribute('aria-valuemax', String(total - length));
    selection.setAttribute('aria-valuenow', String(range.start + 1));
    selection.setAttribute(
      'aria-valuetext',
      `Frames ${range.start + 1} through ${range.end + 1} of ${total}`,
    );
  }
  function clearTimeline() {
    if (timelineGesture) {
      for (const surface of Object.keys(playback))
        playback[surface].playing = timelineGesture.playing[surface];
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
      $('timeline-status').textContent =
        'Drag the selection to move it; drag the handles to resize. Arrow keys adjust one frame.';
    } catch {
      if (revision === timelineRevision)
        $('timeline-status').textContent =
          'Frame previews unavailable. Handles and frame numbers still work.';
    } finally {
      if (revision === timelineRevision) strip.setAttribute('aria-busy', 'false');
    }
  }
  function displayPlaybackFrame(surface, blob, index, original = null) {
    const player = playback[surface],
      url = URL.createObjectURL(blob);
    if (player.frameURL) URL.revokeObjectURL(player.frameURL);
    player.frameURL = url;
    player.frameIndex = index;
    if (surface === 'editor') {
      const animatedCanvas = $('animated-canvas-preview');
      animatedCanvas.src = url;
      animatedCanvas.dataset.frameIndex = String(index);
      animatedCanvas.hidden = false;
      $('editor-canvas').classList.add('playback-hidden');
      if (original?.blob && compareMode) {
        if (originalFrameURL) URL.revokeObjectURL(originalFrameURL);
        originalFrameURL = URL.createObjectURL(original.blob);
        const originalPreview = $('original-animated-preview');
        originalPreview.src = originalFrameURL;
        originalPreview.hidden = false;
        $('original-compare-canvas').hidden = true;
        $('editor-wrap').style.aspectRatio = `${original.width} / ${original.height}`;
      }
      return;
    }
    for (const img of document.querySelectorAll(
      '[data-animated-url]:not(#animated-canvas-preview)',
    )) {
      img.src = url;
      img.dataset.frameIndex = String(index);
    }
  }
  async function renderPlaybackFrame(surface, index, token) {
    const player = playback[surface],
      destination = mode,
      rev = previewRevision;
    try {
      const settings = clone(state()),
        d = editorSize(),
        output =
          destination === 'seventv'
            ? uploadSize()
            : { width: modes[destination].sizes[0], height: modes[destination].sizes[0] },
        size = surface === 'editor' ? d : output,
        result = await engine.call('previewFrame', {
          index,
          state: settings,
          size: size.width,
          height: size.height,
          includeSource: surface === 'editor' && compareMode,
        });
      if (token !== player.revision || rev !== previewRevision || destination !== mode) return;
      displayPlaybackFrame(
        surface,
        result.blob,
        result.index,
        result.sourceBlob
          ? { blob: result.sourceBlob, width: result.sourceWidth, height: result.sourceHeight }
          : null,
      );
      if (!player.playing) return;
      const next = result.index >= animationRange().end ? animationRange().start : result.index + 1,
        delay = playbackDelay(source.frameDelays[result.index]);
      player.timer = setTimeout(() => renderPlaybackFrame(surface, next, token), delay);
    } catch (error) {
      if (token === player.revision) {
        player.playing = false;
        applyPlayback(surface);
        report(
          `${surface === 'editor' ? 'Canvas' : 'Preview'} playback stopped: ${error.message}`,
          true,
        );
      }
    }
  }
  function startPlayback(surface, restart = false) {
    const player = playback[surface],
      token = stopPlaybackClock(surface);
    if (
      restart ||
      !player.frameURL ||
      player.frameIndex < animationRange().start ||
      player.frameIndex > animationRange().end
    ) {
      player.frameIndex = animationRange().start;
      renderPlaybackFrame(surface, player.frameIndex, token);
      return;
    }
    const next =
        player.frameIndex >= animationRange().end ? animationRange().start : player.frameIndex + 1,
      delay = playbackDelay(source.frameDelays[player.frameIndex]);
    player.timer = setTimeout(() => renderPlaybackFrame(surface, next, token), delay);
  }
  function applyPlayback(surface, restart = false) {
    const player = playback[surface],
      isEditor = surface === 'editor',
      control = $(isEditor ? 'editor-animation-toggle' : 'animation-toggle'),
      label = isEditor ? 'canvas' : 'chat preview',
      active = Boolean(source?.animated && outputMedia.length),
      action = player.playing ? 'Pause' : 'Play';
    control.hidden = !active;
    control.setAttribute('aria-pressed', String(player.playing));
    control.setAttribute('aria-label', `${action} animated ${label}`);
    control.removeAttribute('title');
    control.querySelector('use').setAttribute('href', player.playing ? '#i-pause' : '#i-play');
    control.querySelector('span').textContent = action;
    if (!active) {
      stopPlaybackClock(surface);
      if (isEditor) {
        $('animated-canvas-preview').hidden = true;
        $('animated-canvas-preview').removeAttribute('src');
        $('editor-canvas').classList.remove('playback-hidden');
        syncConvertedPreview();
      }
      return;
    }
    if (isEditor) {
      const animatedCanvas = $('animated-canvas-preview'),
        media = outputMedia[0];
      animatedCanvas.dataset.animatedUrl = media.url;
      animatedCanvas.dataset.posterUrl = media.posterUrl;
      if (player.frameURL) animatedCanvas.src = player.frameURL;
      else animatedCanvas.removeAttribute('src');
      animatedCanvas.hidden = !player.frameURL;
      $('editor-canvas').classList.toggle('playback-hidden', Boolean(player.frameURL));
    }
    if (player.playing) startPlayback(surface, restart);
    else {
      const token = stopPlaybackClock(surface);
      if (restart || !player.frameURL) renderPlaybackFrame(surface, player.frameIndex, token);
    }
    if (isEditor) syncConvertedPreview(restart);
  }
  function syncSizeComparison(items = []) {
    $('original-bytes').textContent = source
      ? `${source.type} · ${formatBytes(source.bytes)}`
      : '—';
    $('result-size-label').textContent = mode === 'twitch' ? 'Export · 3 files' : 'Export';
    const total = items.reduce((sum, item) => sum + item.bytes, 0);
    const formats = [...new Set(items.map((item) => item.format).filter(Boolean))];
    $('result-bytes').textContent = items.length
      ? `${formats.join(' / ')} · ${formatBytes(total)}`
      : '—';
    const change = $('size-change');
    change.removeAttribute('data-reduced');
    if (!source) change.textContent = 'Import a file to compare sizes.';
    else if (!items.length) change.textContent = 'Waiting for export';
    else {
      const percent = Math.round(Math.abs(1 - total / source.bytes) * 100);
      change.textContent =
        percent === 0
          ? 'About the same size'
          : `${percent}% ${total < source.bytes ? 'smaller' : 'larger'}`;
      if (total < source.bytes) change.dataset.reduced = 'true';
    }
  }
  function populateOutputs(items = []) {
    syncSizeComparison(items);
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
        const media = {
          size,
          width: item.width,
          height: item.height,
          bytes: item.bytes,
          format: item.format,
          frames: item.frames,
          url,
          posterUrl,
        };
        outputMedia.push(media);
        const img = new Image();
        img.alt = `${size} pixel export preview`;
        img.draggable = false;
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
    applyPlayback('editor', true);
    applyPlayback('preview', true);
  }
  function invalidate() {
    ++previewRevision;
    clearTimeout(previewTimer);
    stopPlaybackClocks();
    clearPlaybackFrames();
    outputs = [];
    syncSizeComparison();
    busy = Boolean(source);
    $('export-status').textContent = source ? 'Preparing export…' : 'Waiting for an image';
    $('animation-toggle').hidden = true;
    $('editor-animation-toggle').hidden = true;
    $('animated-canvas-preview').hidden = true;
    $('animated-canvas-preview').removeAttribute('src');
    $('editor-canvas').classList.remove('playback-hidden');
    clearConvertedPreview();
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
    setCompareMode(false);
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
      const originalThumbnail = $('original-thumbnail'),
        originalContext = originalThumbnail.getContext('2d'),
        thumbnailScale = Math.min(64 / preview.width, 64 / preview.height);
      originalContext.clearRect(0, 0, 64, 64);
      originalContext.drawImage(
        preview,
        (64 - preview.width * thumbnailScale) / 2,
        (64 - preview.height * thumbnailScale) / 2,
        preview.width * thumbnailScale,
        preview.height * thumbnailScale,
      );
      originalThumbnail.hidden = false;
      for (const player of Object.values(playback)) player.playing = true;
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
      $('canvas-instruction').textContent = 'Drag to move · Scroll to zoom · Arrow keys to nudge';
      $('canvas-title').textContent = modes[mode].label;
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
  document.addEventListener('dragstart', (e) => {
    if (e.target.closest('.compare-pane, .output-list, .chat')) e.preventDefault();
  });
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
  for (const [id, surface] of [
    ['editor-animation-toggle', 'editor'],
    ['animation-toggle', 'preview'],
  ])
    $(id).onclick = () => {
      playback[surface].playing = !playback[surface].playing;
      applyPlayback(surface, compareMode && surface === 'editor' && playback[surface].playing);
    };
  $('compare-toggle').onclick = () => setCompareMode(!compareMode);
  $('compare-original').onclick = () => setCompareSide('original');
  $('compare-converted').onclick = () => setCompareSide('converted');
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
        const index = key === 'start-frame' ? animationRange().start : animationRange().end;
        for (const surface of Object.keys(playback)) {
          playback[surface].frameIndex = index;
          renderPlaybackFrame(surface, index, stopPlaybackClock(surface));
        }
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
        playing: Object.fromEntries(
          Object.entries(playback).map(([surface, player]) => [surface, player.playing]),
        ),
      };
      for (const surface of Object.keys(playback)) {
        playback[surface].playing = false;
        stopPlaybackClock(surface);
      }
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
      for (const surface of Object.keys(playback))
        playback[surface].playing = timelineGesture.playing[surface];
      timelineGesture = null;
      trimEdits.delete(key);
      applyPlayback('editor');
      applyPlayback('preview');
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  }
  // Dragging the highlighted selection moves both trim boundaries together.
  {
    const selection = $('trim-range');
    const update = (start, preview = false) => {
      const range = animationRange(),
        total = source.frameDelays.length,
        length = range.end - range.start,
        next = Math.max(0, Math.min(total - length - 1, Math.round(start)));
      range.start = next;
      range.end = next + length;
      clampAnimationRange();
      syncAnimationControls();
      schedulePreview();
      if (preview)
        for (const surface of Object.keys(playback)) {
          playback[surface].frameIndex = range.start;
          renderPlaybackFrame(surface, range.start, stopPlaybackClock(surface));
        }
    };
    selection.addEventListener('keydown', (e) => {
      const range = animationRange(),
        total = source?.frameDelays?.length || 2,
        length = range.end - range.start,
        jumps = {
          ArrowLeft: -1,
          ArrowDown: -1,
          ArrowRight: 1,
          ArrowUp: 1,
          PageDown: -10,
          PageUp: 10,
        };
      let next;
      if (Object.hasOwn(jumps, e.key)) next = range.start + jumps[e.key];
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = total - length - 1;
      else return;
      e.preventDefault();
      if (!source?.animated || importing || exporting) return;
      beginEdit();
      update(next);
    });
    selection.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !source?.animated || importing || exporting || timelineGesture) return;
      const rect = $('frame-timeline').getBoundingClientRect(),
        range = animationRange();
      e.preventDefault();
      selection.setPointerCapture(e.pointerId);
      beginEdit();
      timelineGesture = {
        pointer: e.pointerId,
        key: 'range',
        x: e.clientX,
        width: rect.width,
        start: range.start,
        playing: Object.fromEntries(
          Object.entries(playback).map(([surface, player]) => [surface, player.playing]),
        ),
      };
      for (const surface of Object.keys(playback)) {
        playback[surface].playing = false;
        stopPlaybackClock(surface);
      }
    });
    selection.addEventListener('pointermove', (e) => {
      const gesture = timelineGesture;
      if (
        !gesture ||
        gesture.pointer !== e.pointerId ||
        gesture.key !== 'range' ||
        importing ||
        exporting
      )
        return;
      const total = source.frameDelays.length,
        offset = Math.round(((e.clientX - gesture.x) / gesture.width) * total);
      update(gesture.start + offset, true);
    });
    const finish = (e) => {
      if (
        !timelineGesture ||
        timelineGesture.pointer !== e.pointerId ||
        timelineGesture.key !== 'range'
      )
        return;
      for (const surface of Object.keys(playback))
        playback[surface].playing = timelineGesture.playing[surface];
      timelineGesture = null;
      applyPlayback('editor');
      applyPlayback('preview');
    };
    selection.addEventListener('pointerup', finish);
    selection.addEventListener('pointercancel', finish);
    selection.addEventListener('lostpointercapture', finish);
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
      if (key === 'speed') fitAnimationRangeToLimit();
      if ((key === 'width' || key === 'stretch') && state().autoFill)
        state().zoom = fillZoom(state());
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
  $('auto-fill').onclick = () =>
    change((s) => {
      s.autoFill = !s.autoFill;
      if (s.autoFill) s.zoom = fillZoom(s);
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
  const wheelPixelThreshold = 80,
    wheelDiscreteThreshold = 100,
    wheelMaxSteps = 4,
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
      const magnitude = Math.abs(e.deltaY),
        discrete =
          (e.deltaMode || 0) !== 0 || magnitude === wheelDiscreteThreshold || magnitude === 120;
      if (discrete) wheelPixels = wheelPixelThreshold;
      else wheelPixels += magnitude;
      if (wheelPixels < wheelPixelThreshold) return;
      const steps = discrete
        ? 1
        : Math.min(wheelMaxSteps, Math.floor(wheelPixels / wheelPixelThreshold));
      wheelPixels = discrete ? 0 : wheelPixels % wheelPixelThreshold;
      commitSliderValue('zoom', Number($('zoom').value) + direction * steps);
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
                  playing: {
                    canvas: playback.editor.playing,
                    preview: playback.preview.playing,
                  },
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
