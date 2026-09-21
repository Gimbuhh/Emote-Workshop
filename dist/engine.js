'use strict';
function drawArtwork(ctx, image, state, side, bounds, makeCanvas, height = side) {
  ctx.clearRect(0, 0, side, height);
  const source = state.trim ? bounds : { x: 0, y: 0, w: image.width, h: image.height };
  const width = (state.width ?? 100) / 100,
    stretch = (state.stretch ?? 100) / 100,
    scale = (Math.min(side / (source.w * width), height / (source.h * stretch)) * state.zoom) / 100;
  function place(target) {
    target.save();
    target.translate(side * (0.5 + state.x), height * (0.5 + state.y));
    target.rotate((state.rotation * Math.PI) / 180);
    target.scale((state.flip ? -scale : scale) * width, scale * stretch);
    target.drawImage(
      image,
      source.x,
      source.y,
      source.w,
      source.h,
      -source.w / 2,
      -source.h / 2,
      source.w,
      source.h,
    );
    target.restore();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (state.outline > 0) {
    const mask = makeCanvas(side, height),
      m = mask.getContext('2d');
    place(m);
    m.globalCompositeOperation = 'source-in';
    m.fillStyle = state.color;
    m.fillRect(0, 0, side, height);
    const radius = (state.outline * Math.min(side, height)) / 128;
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      ctx.drawImage(mask, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.drawImage(mask, 0, 0);
  }
  ctx.filter = `brightness(${state.brightness}%)`;
  place(ctx);
  ctx.filter = 'none';
}

function imageWorker() {
  let frames = [],
    delays = [],
    bounds = null,
    animated = false;
  const MAX_BYTES = 100 * 1024 * 1024,
    MAX_PIXELS = 48 * 1000 * 1000,
    MAX_SOURCE_FRAMES = 240,
    MAX_VIDEO_FRAMES = 240,
    MAX_VIDEO_PIXELS = 64 * 1024 * 1024,
    MAX_RENDER_PIXELS = 32 * 1024 * 1024;
  const presets = {
    twitch: {
      sizes: [112, 56, 28],
      limit: 100 * 1024,
      animatedLimit: 512 * 1024,
      duration: Infinity,
      maxFrames: 60,
    },
    emoji: { sizes: [128], limit: 256 * 1024 - 1, duration: Infinity },
    sticker: { sizes: [320], limit: 512 * 1024, duration: Infinity },
    seventv: { sizes: [1000], limit: 7 * 1000 * 1000, duration: Infinity, maxFrames: 1000 },
  };
  const makeCanvas = (w, h) => new OffscreenCanvas(w, h),
    ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  const concat = (parts) => {
    const total = parts.reduce((n, part) => n + part.length, 0),
      out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  const le16 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255]),
    le24 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255]),
    be32 = (value) =>
      new Uint8Array([
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255,
      ]);

  function checkDimensions(width, height) {
    if (!width || !height)
      throw new Error('The image dimensions could not be read. The file may be damaged.');
    if (width * height > MAX_PIXELS || Math.max(width, height) > 20000)
      throw new Error(
        'This image exceeds the 48-megapixel / 20,000-pixel-side limit. Reduce its dimensions and try again.',
      );
  }
  function sourceFrameStride(count, width, height) {
    const pixels = Math.max(1, width * height),
      pixelBudgetFrames = Math.max(2, Math.floor(MAX_RENDER_PIXELS / pixels)),
      frameLimit = Math.min(MAX_SOURCE_FRAMES, pixelBudgetFrames);
    return Math.max(1, Math.ceil(count / frameLimit));
  }

  function inspectAvif(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0,
      height = 0,
      recognized = false,
      sequence = false;
    const damaged = () => {
      throw new Error('This AVIF appears to be incomplete or damaged.');
    };
    function boxes(start, end, depth = 0) {
      if (depth > 8) damaged();
      for (let p = start; p < end;) {
        if (end - p < 8) damaged();
        let size = view.getUint32(p),
          header = 8;
        const tag = ascii(bytes, p + 4, 4);
        if (size === 1) {
          if (end - p < 16) damaged();
          size = view.getUint32(p + 8) * 4294967296 + view.getUint32(p + 12);
          header = 16;
        } else if (size === 0) size = end - p;
        if (!Number.isSafeInteger(size) || size < header || size > end - p) damaged();
        const data = p + header,
          next = p + size;
        if (tag === 'ftyp' && depth === 0) {
          if (next - data < 8 || (next - data) % 4) damaged();
          for (let b = data; b < next; b += 4) {
            if (b === data + 4) continue; // Minor version is not a brand.
            const brand = ascii(bytes, b, 4);
            if (brand === 'avif' || brand === 'avis') recognized = true;
            if (brand === 'avis') sequence = true;
          }
        } else if (tag === 'ispe') {
          if (next - data < 12) damaged();
          width = Math.max(width, view.getUint32(data + 4));
          height = Math.max(height, view.getUint32(data + 8));
        } else if (tag === 'tkhd') {
          if (next - data < 4 || bytes[data] > 1) damaged();
          const offset = bytes[data] === 1 ? 88 : 76;
          if (next - data < offset + 8) damaged();
          width = Math.max(width, Math.ceil(view.getUint32(data + offset) / 65536));
          height = Math.max(height, Math.ceil(view.getUint32(data + offset + 4) / 65536));
        } else if (['meta', 'iprp', 'ipco', 'moov', 'trak'].includes(tag)) {
          const child = data + (tag === 'meta' ? 4 : 0);
          if (child > next) damaged();
          boxes(child, next, depth + 1);
        }
        p = next;
      }
    }
    boxes(0, bytes.length);
    if (!recognized) throw new Error('This file is not an AVIF image.');
    checkDimensions(width, height);
    return { width, height, type: 'AVIF', mime: 'image/avif', animated: sequence };
  }

  function inspect(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0,
      height = 0,
      type = '',
      mime = '',
      isAnimated = false;
    if (bytes.length >= 24 && ascii(bytes, 1, 3) === 'PNG' && bytes[0] === 137) {
      type = 'PNG';
      mime = 'image/png';
      width = v.getUint32(16);
      height = v.getUint32(20);
      for (let p = 8; p + 12 <= bytes.length;) {
        const len = v.getUint32(p),
          tag = ascii(bytes, p + 4, 4);
        if (tag === 'acTL') isAnimated = true;
        if (len > bytes.length - p - 12)
          throw new Error('This PNG appears to be incomplete or damaged.');
        p += len + 12;
      }
    } else if (
      bytes.length >= 12 &&
      ascii(bytes, 0, 4) === 'RIFF' &&
      ascii(bytes, 8, 4) === 'WEBP'
    ) {
      type = 'WebP';
      mime = 'image/webp';
      for (let p = 12; p + 8 <= bytes.length;) {
        const tag = ascii(bytes, p, 4),
          len = v.getUint32(p + 4, true),
          d = p + 8;
        if (len > bytes.length - d)
          throw new Error('This WebP appears to be incomplete or damaged.');
        if (tag === 'ANIM' || (tag === 'VP8X' && bytes[d] & 2)) isAnimated = true;
        if (tag === 'VP8X' && len >= 10) {
          width = 1 + bytes[d + 4] + (bytes[d + 5] << 8) + (bytes[d + 6] << 16);
          height = 1 + bytes[d + 7] + (bytes[d + 8] << 8) + (bytes[d + 9] << 16);
        }
        if (!width && tag === 'VP8 ' && len >= 10) {
          width = v.getUint16(d + 6, true) & 16383;
          height = v.getUint16(d + 8, true) & 16383;
        }
        if (!width && tag === 'VP8L' && len >= 5) {
          const bits = v.getUint32(d + 1, true);
          width = (bits & 16383) + 1;
          height = ((bits >>> 14) & 16383) + 1;
        }
        p = d + len + (len % 2);
      }
    } else if (
      bytes.length >= 10 &&
      (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')
    ) {
      type = 'GIF';
      mime = 'image/gif';
      width = v.getUint16(6, true);
      height = v.getUint16(8, true);
      isAnimated = true;
    } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
      type = 'JPEG';
      mime = 'image/jpeg';
      let p = 2;
      while (p + 4 <= bytes.length) {
        if (bytes[p] !== 255) break;
        while (bytes[p] === 255) p++;
        const marker = bytes[p++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        if (p + 2 > bytes.length) break;
        const len = v.getUint16(p);
        if (len < 2 || p + len > bytes.length) break;
        if (
          [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
          len >= 7
        ) {
          height = v.getUint16(p + 3);
          width = v.getUint16(p + 5);
          break;
        }
        p += len;
      }
    } else if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') {
      return inspectAvif(bytes);
    } else throw new Error('Choose a PNG, JPG, GIF, WebP, AVIF, or MP4 file.');
    checkDimensions(width, height);
    return { width, height, type, mime, animated: isAnimated };
  }
  async function decodeAnimation(buffer, details, reportProgress = () => {}) {
    if (!self.ImageDecoder)
      throw new Error(
        'Animated image editing needs a current Chromium browser. Open this file in Chrome or Edge.',
      );
    if (ImageDecoder.isTypeSupported && !(await ImageDecoder.isTypeSupported(details.mime)))
      throw new Error(`This browser cannot decode animated ${details.type} files.`);
    const ratio = Math.min(1, 512 / Math.max(details.width, details.height)),
      options = { data: buffer, type: details.mime, preferAnimation: true };
    if (ratio < 1) {
      options.desiredWidth = Math.max(1, Math.round(details.width * ratio));
      options.desiredHeight = Math.max(1, Math.round(details.height * ratio));
    }
    const decoder = new ImageDecoder(options);
    const decoded = [];
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const count = Math.max(1, decoder.tracks.selectedTrack?.frameCount || 1),
        workingWidth = options.desiredWidth || details.width,
        workingHeight = options.desiredHeight || details.height,
        stride = sourceFrameStride(count, workingWidth, workingHeight),
        frameDelays = [],
        indices = [];
      for (let index = 0; index < count; index += stride) indices.push(index);
      reportProgress({ phase: 'decode', current: 0, total: indices.length });
      // A small batch lets Chromium pipeline independent frame requests without holding an
      // entire large animation's decoded VideoFrames in memory at once.
      const batchSize = Math.max(
        2,
        Math.min(8, Math.floor(8_000_000 / (workingWidth * workingHeight * 4))),
      );
      for (let offset = 0; offset < indices.length; offset += batchSize) {
        const batch = indices.slice(offset, offset + batchSize),
          results = await Promise.allSettled(
            batch.map((frameIndex) => decoder.decode({ frameIndex, completeFramesOnly: true })),
          );
        try {
          for (const result of results) {
            if (result.status === 'rejected') throw result.reason;
            const frame = result.value.image;
            checkDimensions(frame.displayWidth, frame.displayHeight);
            decoded.push(await createImageBitmap(frame));
            frameDelays.push(
              Math.max(20, Math.min(1000, Math.round((frame.duration || 100000) / 1000))) * stride,
            );
          }
        } finally {
          for (const result of results)
            if (result.status === 'fulfilled') result.value.image.close();
        }
        reportProgress({
          phase: 'decode',
          current: Math.min(indices.length, offset + batch.length),
          total: indices.length,
        });
      }
      return { decoded, frameDelays, originalFrames: count, sampled: stride > 1 };
    } catch (error) {
      for (const frame of decoded) frame.close();
      throw error;
    } finally {
      decoder.close();
    }
  }
  function findBounds(images, reportProgress = () => {}) {
    if (!Array.isArray(images)) images = [images];
    const image = images[0];
    const ratio = Math.min(1, 2048 / Math.max(image.width, image.height)),
      thumb = makeCanvas(
        Math.max(1, Math.round(image.width * ratio)),
        Math.max(1, Math.round(image.height * ratio)),
      ),
      tc = thumb.getContext('2d', { willReadFrequently: true });
    let minX = thumb.width,
      minY = thumb.height,
      maxX = -1,
      maxY = -1,
      hasTransparency = false;
    // One shared crop must contain the artwork in every retained animation frame.
    reportProgress({ phase: 'analyze', current: 0, total: images.length });
    for (let frameIndex = 0; frameIndex < images.length; frameIndex++) {
      const frame = images[frameIndex];
      tc.clearRect(0, 0, thumb.width, thumb.height);
      tc.drawImage(frame, 0, 0, thumb.width, thumb.height);
      const pixels = tc.getImageData(0, 0, thumb.width, thumb.height).data;
      for (let y = 0; y < thumb.height; y++) {
        let firstVisible = -1,
          lastVisible = -1;
        for (let x = 0; x < thumb.width; x++) {
          const alpha = pixels[(y * thumb.width + x) * 4 + 3];
          if (alpha < 255) hasTransparency = true;
          if (alpha > 1) {
            if (firstVisible < 0) firstVisible = x;
            lastVisible = x;
          }
        }
        if (firstVisible >= 0) {
          if (firstVisible < minX) minX = firstVisible;
          if (lastVisible > maxX) maxX = lastVisible;
          if (y < minY) minY = y;
          maxY = y;
        }
      }
      if ((frameIndex + 1) % 8 === 0 || frameIndex + 1 === images.length)
        reportProgress({ phase: 'analyze', current: frameIndex + 1, total: images.length });
    }
    if (maxX < 0)
      throw new Error('This image is fully transparent. Choose an image with visible artwork.');
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(thumb.width - 1, maxX + 1);
    maxY = Math.min(thumb.height - 1, maxY + 1);
    tc.clearRect(0, 0, thumb.width, thumb.height);
    tc.drawImage(image, 0, 0, thumb.width, thumb.height);
    return {
      thumb,
      hasTransparency,
      source: {
        x: (minX / thumb.width) * image.width,
        y: (minY / thumb.height) * image.height,
        w: ((maxX - minX + 1) / thumb.width) * image.width,
        h: ((maxY - minY + 1) / thumb.height) * image.height,
      },
      preview: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    };
  }
  async function load(file, reportProgress = () => {}) {
    if (!file.size) throw new Error('This file is empty. Choose an image with content.');
    if (file.size > MAX_BYTES)
      throw new Error(
        'This file is larger than the 100 MB import limit. Choose a smaller source file.',
      );
    const buffer = await file.arrayBuffer(),
      details = inspect(new Uint8Array(buffer));
    let decoded,
      frameDelays,
      originalFrames = 1,
      sampled = false;
    try {
      if (details.animated) {
        const animation = await decodeAnimation(buffer, details, reportProgress);
        decoded = animation.decoded;
        frameDelays = animation.frameDelays;
        originalFrames = animation.originalFrames;
        sampled = animation.sampled;
      } else {
        decoded = [await createImageBitmap(file, { imageOrientation: 'from-image' })];
        frameDelays = [0];
      }
      checkDimensions(decoded[0].width, decoded[0].height);
      if (details.type === 'AVIF' && !details.animated) {
        details.width = decoded[0].width;
        details.height = decoded[0].height;
      }
      const measured = findBounds(decoded, reportProgress),
        preview = await measured.thumb.convertToBlob({ type: 'image/png' });
      for (const frame of frames) frame.close();
      frames = decoded;
      delays = frameDelays;
      bounds = measured.source;
      animated = details.animated && decoded.length > 1;
      return {
        ...details,
        animated,
        bytes: file.size,
        preview,
        workingWidth: decoded[0].width,
        workingHeight: decoded[0].height,
        bounds: measured.preview,
        hasTransparency: measured.hasTransparency,
        frames: decoded.length,
        originalFrames,
        decodedFrames: decoded.length,
        frameDelays,
        sampled,
        duration: frameDelays.reduce((a, b) => a + b, 0),
      };
    } catch (error) {
      if (decoded) for (const frame of decoded) frame.close();
      throw error;
    }
  }
  async function loadVideo(videoFrames, frameDelays, details) {
    try {
      if (
        !Array.isArray(videoFrames) ||
        !Array.isArray(frameDelays) ||
        videoFrames.length < 2 ||
        videoFrames.length !== frameDelays.length
      )
        throw new Error('The MP4 could not be converted into animation frames.');
      if (videoFrames.length > MAX_VIDEO_FRAMES)
        throw new Error(`MP4 imports allow at most ${MAX_VIDEO_FRAMES} decoded frames.`);
      let sourcePixels = 0,
        sourceDuration = 0;
      for (let index = 0; index < videoFrames.length; index++) {
        const frame = videoFrames[index],
          delay = frameDelays[index];
        if (
          !Number.isInteger(frame?.width) ||
          !Number.isInteger(frame?.height) ||
          frame.width < 1 ||
          frame.height < 1 ||
          Math.max(frame.width, frame.height) > 512
        )
          throw new Error('Decoded MP4 frames must be at most 512 pixels on their longest side.');
        sourcePixels += frame.width * frame.height;
        if (sourcePixels > MAX_VIDEO_PIXELS)
          throw new Error('The decoded MP4 is too large to process safely. Shorten the video.');
        if (!Number.isFinite(delay) || delay <= 0)
          throw new Error('The MP4 contains invalid frame timing.');
        sourceDuration += delay;
        if (!Number.isFinite(sourceDuration))
          throw new Error('The MP4 contains invalid frame timing.');
      }
      const measured = findBounds(videoFrames),
        preview = await measured.thumb.convertToBlob({ type: 'image/png' });
      for (const frame of frames) frame.close();
      frames = videoFrames;
      delays = frameDelays;
      bounds = measured.source;
      animated = true;
      return {
        width: details.width,
        height: details.height,
        type: 'MP4',
        mime: 'video/mp4',
        animated: true,
        bytes: details.bytes,
        preview,
        workingWidth: videoFrames[0].width,
        workingHeight: videoFrames[0].height,
        bounds: measured.preview,
        hasTransparency: measured.hasTransparency,
        frames: videoFrames.length,
        originalFrames: details.originalFrames,
        decodedFrames: videoFrames.length,
        frameDelays,
        sampled: details.sampled,
        duration: frameDelays.reduce((a, b) => a + b, 0),
      };
    } catch (error) {
      if (Array.isArray(videoFrames)) for (const frame of videoFrames) frame?.close?.();
      throw error;
    }
  }
  function checkState(s) {
    if (
      !s ||
      !Number.isFinite(s.zoom) ||
      s.zoom < 10 ||
      s.zoom > 300 ||
      !Number.isFinite(s.width ?? 100) ||
      (s.width ?? 100) < 100 ||
      (s.width ?? 100) > 300 ||
      !Number.isFinite(s.stretch ?? 100) ||
      (s.stretch ?? 100) < 100 ||
      (s.stretch ?? 100) > 300 ||
      !Number.isFinite(s.speed ?? 100) ||
      (s.speed ?? 100) < 50 ||
      (s.speed ?? 100) > 150 ||
      !Number.isFinite(s.x) ||
      !Number.isFinite(s.y) ||
      Math.abs(s.x) > 2 ||
      Math.abs(s.y) > 2 ||
      !Number.isFinite(s.rotation) ||
      Math.abs(s.rotation) > 180 ||
      !Number.isFinite(s.outline) ||
      s.outline < 0 ||
      s.outline > 6 ||
      !Number.isFinite(s.brightness) ||
      s.brightness < 50 ||
      s.brightness > 150 ||
      !/^#[0-9a-f]{6}$/i.test(s.color) ||
      typeof s.flip !== 'boolean' ||
      typeof s.trim !== 'boolean'
    )
      throw new Error('Invalid editing settings. Reset the framing and try again.');
  }
  function selectedAnimation(maxDuration, step = 1, range, speed = 100) {
    const selected = [],
      selectedDelays = [];
    let elapsed = 0;
    const start = Math.max(0, Math.min(frames.length - 2, Math.round(range?.start ?? 0))),
      end = Math.max(
        start + 1,
        Math.min(frames.length - 1, Math.round(range?.end ?? frames.length - 1)),
      );
    for (let i = start; i <= end && elapsed < maxDuration; i += step) {
      let delay = 0;
      for (let j = i; j <= Math.min(end, i + step - 1); j++)
        delay += Math.max(20, ((delays[j] || 100) * 100) / speed);
      delay = Math.min(Math.max(20, delay), maxDuration - elapsed);
      if (delay < 20 && selectedDelays.length) {
        selectedDelays[selectedDelays.length - 1] += delay;
        elapsed += delay;
        break;
      }
      selected.push(i);
      selectedDelays.push(delay);
      elapsed += delay;
    }
    return { selected, selectedDelays, duration: elapsed };
  }

  function lzw(indices, minCodeSize) {
    const clear = 1 << minCodeSize,
      end = clear + 1;
    let next = end + 1,
      codeSize = minCodeSize + 1,
      bitBuffer = 0,
      bitCount = 0;
    const bytes = [],
      dict = new Map();
    const write = (code) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        bytes.push(bitBuffer & 255);
        bitBuffer >>>= 8;
        bitCount -= 8;
      }
    };
    const reset = () => {
      dict.clear();
      next = end + 1;
      codeSize = minCodeSize + 1;
    };
    write(clear);
    let prefix = indices[0] || 0;
    for (let i = 1; i < indices.length; i++) {
      const value = indices[i],
        key = prefix * 256 + value;
      if (dict.has(key)) prefix = dict.get(key);
      else {
        write(prefix);
        if (next < 4096) {
          dict.set(key, next++);
          if (next > 1 << codeSize && codeSize < 12) codeSize++;
        } else {
          write(clear);
          reset();
        }
        prefix = value;
      }
    }
    write(prefix);
    write(end);
    if (bitCount) bytes.push(bitBuffer & 255);
    const blocks = [];
    for (let i = 0; i < bytes.length; i += 255)
      blocks.push(new Uint8Array([Math.min(255, bytes.length - i), ...bytes.slice(i, i + 255)]));
    blocks.push(new Uint8Array([0]));
    return concat(blocks);
  }
  function makePalette(rgbaFrames, paletteSize) {
    // A shared, weighted median-cut palette keeps rare colors and stays stable in motion.
    const histogram = new Uint32Array(32768),
      sums = [new Float64Array(32768), new Float64Array(32768), new Float64Array(32768)];
    let pixelCount = 0;
    for (const rgba of rgbaFrames) pixelCount += rgba.length / 4;
    const stride = Math.max(1, Math.ceil(pixelCount / 700000));
    for (let f = 0; f < rgbaFrames.length; f++) {
      const rgba = rgbaFrames[f];
      for (let p = (f % stride) * 4; p < rgba.length; p += 4 * stride)
        if (rgba[p + 3] >= 128) {
          const bin = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
          histogram[bin]++;
          for (let c = 0; c < 3; c++) sums[c][bin] += rgba[p + c];
        }
    }
    const bins = [];
    for (let i = 0; i < histogram.length; i++) if (histogram[i]) bins.push(i);
    const channel = (bin, c) => sums[c][bin] / histogram[bin];
    function box(items) {
      let count = 0;
      const lo = [255, 255, 255],
        hi = [0, 0, 0];
      for (const bin of items) {
        count += histogram[bin];
        for (let c = 0; c < 3; c++) {
          const value = channel(bin, c);
          lo[c] = Math.min(lo[c], value);
          hi[c] = Math.max(hi[c], value);
        }
      }
      const spans = hi.map((v, c) => v - lo[c]),
        axis = spans.indexOf(Math.max(...spans));
      return { items, count, axis, score: items.length > 1 ? count * spans[axis] ** 2 : 0 };
    }
    const boxes = bins.length ? [box(bins)] : [];
    while (boxes.length < paletteSize - 1) {
      let best = -1;
      for (let i = 0; i < boxes.length; i++)
        if (boxes[i].score > 0 && (best < 0 || boxes[i].score > boxes[best].score)) best = i;
      if (best < 0) break;
      const current = boxes[best],
        items = current.items.sort((a, b) => channel(a, current.axis) - channel(b, current.axis));
      let count = 0,
        split = 0;
      while (split < items.length - 1 && count < current.count / 2)
        count += histogram[items[split++]];
      boxes.splice(best, 1, box(items.slice(0, split)), box(items.slice(split)));
    }
    const colors = boxes.map(({ items, count }) =>
      [0, 1, 2].map((c) => Math.round(items.reduce((sum, bin) => sum + sums[c][bin], 0) / count)),
    );
    if (!colors.length) colors.push([0, 0, 0]);
    const table = new Uint8Array(3 * 2 ** Math.max(1, Math.ceil(Math.log2(colors.length + 1)))),
      lookup = new Uint8Array(32768);
    colors.forEach((color, i) => table.set(color, (i + 1) * 3));
    for (let bin = 0; bin < lookup.length; bin++) {
      const r = histogram[bin] ? channel(bin, 0) : ((bin >> 10) & 31) * 8 + 4,
        g = histogram[bin] ? channel(bin, 1) : ((bin >> 5) & 31) * 8 + 4,
        b = histogram[bin] ? channel(bin, 2) : (bin & 31) * 8 + 4;
      let best = 0,
        distance = Infinity;
      for (let i = 0; i < colors.length; i++) {
        const c = colors[i],
          d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
        if (d < distance) {
          distance = d;
          best = i;
        }
      }
      lookup[bin] = best + 1;
    }
    return { table, lookup };
  }
  function encodeGif(rgbaFrames, width, height, frameDelays, paletteSize, maxFrames = 1000) {
    if (
      !Array.isArray(rgbaFrames) ||
      !Array.isArray(frameDelays) ||
      rgbaFrames.length !== frameDelays.length ||
      !Number.isInteger(maxFrames) ||
      maxFrames < 1
    )
      throw new Error('Invalid GIF animation data.');
    const { table, lookup } = makePalette(rgbaFrames, paletteSize),
      colorBits = Math.log2(table.length / 3),
      sizeCode = colorBits - 1,
      encoder = new TextEncoder();
    const parts = [
        encoder.encode('GIF89a'),
        le16(width),
        le16(height),
        new Uint8Array([0x80 | 0x70 | sizeCode, 0, 0]),
        table,
        new Uint8Array([
          0x21,
          0xff,
          0x0b,
          ...encoder.encode('NETSCAPE2.0'),
          0x03,
          0x01,
          0x00,
          0x00,
          0x00,
        ]),
      ],
      minCodeSize = Math.max(2, colorBits);
    const indexed = [];
    let elapsed = 0,
      ticks = 0;
    for (let f = 0; f < rgbaFrames.length; f++) {
      const rgba = rgbaFrames[f],
        pixels = new Uint8Array(width * height);
      if (!Number.isFinite(frameDelays[f]) || frameDelays[f] <= 0)
        throw new Error('This animation contains invalid frame timing.');
      for (let i = 0, p = 0; i < pixels.length; i++, p += 4)
        pixels[i] =
          rgba[p + 3] < 128
            ? 0
            : lookup[((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)];
      elapsed += frameDelays[f];
      const delay = Math.max(2, Math.round(elapsed / 10) - ticks);
      if (!Number.isFinite(delay)) throw new Error('This animation contains invalid frame timing.');
      ticks += delay;
      let remaining = delay,
        previous = indexed[indexed.length - 1],
        same = previous && pixels.every((v, i) => v === previous.pixels[i]);
      while (remaining) {
        const available = same ? 65535 - previous.delay : 0;
        if (available > 0) {
          const merged = Math.min(available, remaining);
          previous.delay += merged;
          remaining -= merged;
          continue;
        }
        const chunk = Math.min(65535, remaining);
        if (indexed.length >= maxFrames)
          throw new Error(
            `This destination allows at most ${maxFrames} timing frames. Shorten the animation.`,
          );
        indexed.push({ pixels, delay: chunk });
        remaining -= chunk;
        previous = indexed[indexed.length - 1];
        same = true;
      }
    }
    let previous = null;
    for (let f = 0; f < indexed.length; f++) {
      const { pixels, delay } = indexed[f],
        next = indexed[(f + 1) % indexed.length].pixels;
      // Clear full frames only when the next frame needs opaque pixels erased.
      // This also restores transparency at the loop boundary.
      const clear = pixels.some((v, i) => v !== 0 && next[i] === 0);
      let left = 0,
        top = 0,
        right = width - 1,
        bottom = height - 1;
      if (previous && !clear) {
        left = width;
        top = height;
        right = -1;
        bottom = -1;
        for (let i = 0; i < pixels.length; i++)
          if (pixels[i] !== previous[i]) {
            const x = i % width,
              y = Math.floor(i / width);
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        if (right < 0) {
          left = top = right = bottom = 0;
        }
      }
      const w = right - left + 1,
        h = bottom - top + 1,
        rectangle = new Uint8Array(w * h),
        delta = new Uint8Array(w * h);
      for (let y = 0, p = 0; y < h; y++)
        for (let x = 0; x < w; x++, p++) {
          const i = (top + y) * width + left + x;
          rectangle[p] = pixels[i];
          delta[p] = previous && previous[i] === pixels[i] ? 0 : pixels[i];
        }
      let compressed = lzw(rectangle, minCodeSize);
      if (previous && !clear) {
        const sparse = lzw(delta, minCodeSize);
        if (sparse.length < compressed.length) compressed = sparse;
      }
      parts.push(
        new Uint8Array([0x21, 0xf9, 0x04, clear ? 0x09 : 0x05, delay & 255, delay >>> 8, 0, 0]),
        new Uint8Array([0x2c, ...le16(left), ...le16(top), ...le16(w), ...le16(h), 0]),
        new Uint8Array([minCodeSize]),
        compressed,
      );
      previous = clear ? null : pixels;
    }
    parts.push(new Uint8Array([0x3b]));
    return { bytes: concat(parts), frames: indexed.length, duration: ticks * 10 };
  }
  function webpChunk(type, data) {
    const size = new Uint8Array(4),
      view = new DataView(size.buffer);
    view.setUint32(0, data.length, true);
    return concat([
      new TextEncoder().encode(type),
      size,
      data,
      data.length % 2 ? new Uint8Array(1) : new Uint8Array(0),
    ]);
  }
  function webpPayload(bytes) {
    if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP')
      throw new Error('The browser returned an invalid WebP frame.');
    const chunks = [];
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = ascii(bytes, offset, 4),
        size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true),
        end = offset + 8 + size;
      if (end > bytes.length) throw new Error('The browser returned a damaged WebP frame.');
      if (type === 'ALPH' || type === 'VP8 ' || type === 'VP8L')
        chunks.push(webpChunk(type, bytes.subarray(offset + 8, end)));
      offset = end + (size % 2);
    }
    if (!chunks.some((chunk) => ascii(chunk, 0, 4) === 'VP8 ' || ascii(chunk, 0, 4) === 'VP8L'))
      throw new Error('The browser could not encode a WebP frame.');
    return concat(chunks);
  }
  async function encodeAnimatedWebp(rgbaFrames, width, height, frameDelays, quality) {
    const canvas = makeCanvas(width, height),
      context = canvas.getContext('2d'),
      chunks = [],
      vp8x = new Uint8Array(10);
    vp8x[0] = 0x12;
    vp8x.set(le24(width - 1), 4);
    vp8x.set(le24(height - 1), 7);
    chunks.push(webpChunk('VP8X', vp8x), webpChunk('ANIM', new Uint8Array(6)));
    for (let index = 0; index < rgbaFrames.length; index++) {
      context.putImageData(new ImageData(rgbaFrames[index], width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality }),
        bytes = new Uint8Array(await blob.arrayBuffer());
      if (blob.type !== 'image/webp') throw new Error('WebP encoding is unavailable.');
      const header = concat([
          le24(0),
          le24(0),
          le24(width - 1),
          le24(height - 1),
          le24(Math.max(1, Math.min(0xffffff, Math.round(frameDelays[index])))),
          new Uint8Array([2]),
        ]),
        payload = webpPayload(bytes);
      chunks.push(webpChunk('ANMF', concat([header, payload])));
    }
    const body = concat([new TextEncoder().encode('WEBP'), ...chunks]),
      riffSize = new Uint8Array(4);
    new DataView(riffSize.buffer).setUint32(0, body.length, true);
    return concat([new TextEncoder().encode('RIFF'), riffSize, body]);
  }
  let crcTable;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function pngChunk(name, data) {
    const type = new TextEncoder().encode(name),
      crc = be32(crc32(concat([type, data])));
    return concat([be32(data.length), type, data, crc]);
  }
  function quantizeRgba(rgba, quantize) {
    const result = new Uint8Array(rgba.length);
    for (let index = 0; index < rgba.length; index += 4) {
      const alpha = rgba[index + 3];
      result[index + 3] = alpha;
      if (!alpha) continue;
      for (let channel = 0; channel < 3; channel++) {
        const value = rgba[index + channel];
        result[index + channel] =
          quantize > 1 ? Math.min(255, Math.round(value / quantize) * quantize) : value;
      }
    }
    return result;
  }
  function paethPredictor(left, above, upperLeft) {
    const estimate = left + above - upperLeft,
      leftDistance = Math.abs(estimate - left),
      aboveDistance = Math.abs(estimate - above),
      upperLeftDistance = Math.abs(estimate - upperLeft);
    return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
      ? left
      : aboveDistance <= upperLeftDistance
        ? above
        : upperLeft;
  }
  function filterPngRows(rgba, width, height) {
    const stride = width * 4,
      raw = new Uint8Array(height * (stride + 1)),
      candidate = new Uint8Array(stride);
    let output = 0;
    for (let y = 0; y < height; y++) {
      const rowStart = y * stride,
        previousStart = rowStart - stride;
      let bestFilter = 0,
        bestScore = Infinity,
        bestRow = null;
      for (let filter = 0; filter <= 4; filter++) {
        let score = 0;
        for (let x = 0; x < stride; x++) {
          const value = rgba[rowStart + x],
            left = x >= 4 ? rgba[rowStart + x - 4] : 0,
            above = y ? rgba[previousStart + x] : 0,
            upperLeft = y && x >= 4 ? rgba[previousStart + x - 4] : 0,
            prediction =
              filter === 0
                ? 0
                : filter === 1
                  ? left
                  : filter === 2
                    ? above
                    : filter === 3
                      ? Math.floor((left + above) / 2)
                      : paethPredictor(left, above, upperLeft),
            filtered = (value - prediction + 256) & 255;
          candidate[x] = filtered;
          score += Math.min(filtered, 256 - filtered);
        }
        if (score < bestScore) {
          bestScore = score;
          bestFilter = filter;
          bestRow = candidate.slice();
        }
      }
      raw[output++] = bestFilter;
      raw.set(bestRow, output);
      output += stride;
    }
    return raw;
  }
  function apngRegion(rgba, canvasWidth, x, y, width, height) {
    const result = new Uint8Array(width * height * 4),
      sourceStride = canvasWidth * 4,
      rowBytes = width * 4;
    for (let row = 0; row < height; row++) {
      const source = (y + row) * sourceStride + x * 4;
      result.set(rgba.subarray(source, source + rowBytes), row * rowBytes);
    }
    return result;
  }
  function apngDelta(current, previous, width, height) {
    if (!previous) return { x: 0, y: 0, width, height, rgba: current };
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        if (
          current[at] === previous[at] &&
          current[at + 1] === previous[at + 1] &&
          current[at + 2] === previous[at + 2] &&
          current[at + 3] === previous[at + 3]
        )
          continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) return null;
    const regionWidth = maxX - minX + 1,
      regionHeight = maxY - minY + 1;
    return {
      x: minX,
      y: minY,
      width: regionWidth,
      height: regionHeight,
      rgba: apngRegion(current, width, minX, minY, regionWidth, regionHeight),
    };
  }
  async function deflateRgba(rgba, width, height) {
    const raw = filterPngRows(rgba, width, height);
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function encodeApng(rgbaFrames, width, height, frameDelays, quantize) {
    if (!self.CompressionStream)
      throw new Error('Animated sticker export needs a current Chrome or Edge browser.');
    const prepared = [];
    let previous = null;
    for (let index = 0; index < rgbaFrames.length; index++) {
      const current = quantizeRgba(rgbaFrames[index], quantize),
        delay = Math.max(20, Math.min(65535, Math.round(frameDelays[index]))),
        delta = apngDelta(current, previous, width, height);
      if (!delta && prepared.length && prepared.at(-1).delay + delay <= 65535)
        prepared.at(-1).delay += delay;
      else
        prepared.push({
          ...(delta || {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            rgba: apngRegion(current, width, 0, 0, 1, 1),
          }),
          delay,
        });
      previous = current;
    }
    const ihdr = concat([be32(width), be32(height), new Uint8Array([8, 6, 0, 0, 0])]),
      parts = [
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', ihdr),
        pngChunk('acTL', concat([be32(prepared.length), be32(0)])),
      ];
    let sequence = 0;
    for (let index = 0; index < prepared.length; index++) {
      const frame = prepared[index],
        control = concat([
          be32(sequence++),
          be32(frame.width),
          be32(frame.height),
          be32(frame.x),
          be32(frame.y),
          new Uint8Array([frame.delay >>> 8, frame.delay & 255, 0x03, 0xe8, 0, 0]),
        ]);
      parts.push(pngChunk('fcTL', control));
      const compressed = await deflateRgba(frame.rgba, frame.width, frame.height);
      parts.push(
        index === 0
          ? pngChunk('IDAT', compressed)
          : pngChunk('fdAT', concat([be32(sequence++), compressed])),
      );
    }
    parts.push(pngChunk('IEND', new Uint8Array()));
    return {
      bytes: concat(parts),
      frames: prepared.length,
      duration: prepared.reduce((total, frame) => total + frame.delay, 0),
    };
  }
  function visible(rgba) {
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) return true;
    return false;
  }
  function checkRenderBudget(width, height, frameCount) {
    if (width * height * frameCount > MAX_RENDER_PIXELS) {
      throw new Error(
        'This animation is too large to process safely. Shorten it or reduce its dimensions.',
      );
    }
  }
  function renderPlan(size, height, preset, range, speed) {
    const complete = selectedAnimation(preset.duration, 1, range, speed),
      renderFrameLimit = preset.renderMaxFrames || 1000;
    if (complete.selected.length > renderFrameLimit)
      throw new Error(
        `This destination allows at most ${renderFrameLimit} frames. Shorten the animation.`,
      );
    const allowedFrames = Math.max(1, Math.floor(MAX_RENDER_PIXELS / (size * height))),
      step = Math.max(1, Math.ceil(complete.selected.length / allowedFrames));
    return step === 1 ? complete : selectedAnimation(preset.duration, step, range, speed);
  }
  function renderFrames(size, state, preset, range, height = size) {
    const plan = renderPlan(size, height, preset, range, state.speed ?? 100),
      rgba = [];
    checkRenderBudget(size, height, plan.selected.length);
    for (const index of plan.selected) {
      const canvas = makeCanvas(size, height),
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      drawArtwork(ctx, frames[index], state, size, bounds, makeCanvas, height);
      const pixels = ctx.getImageData(0, 0, size, height).data;
      if (!visible(pixels))
        throw new Error(
          'The artwork is outside the canvas. Use Center image or Fit to bring it back.',
        );
      rgba.push(pixels);
    }
    return { ...plan, rgba };
  }
  async function previewFrame(index, state, size, height = size, includeSource = false) {
    if (!frames.length) throw new Error('Import media first.');
    checkState(state);
    if (
      !Number.isInteger(size) ||
      !Number.isInteger(height) ||
      size < 1 ||
      height < 1 ||
      size > 1000 ||
      height > 1000
    )
      throw new Error('Invalid preview dimensions.');
    const frameIndex = Math.max(0, Math.min(frames.length - 1, Math.round(index))),
      canvas = makeCanvas(size, height),
      ctx = canvas.getContext('2d');
    drawArtwork(ctx, frames[frameIndex], state, size, bounds, makeCanvas, height);
    const result = {
      index: frameIndex,
      blob: await canvas.convertToBlob({ type: 'image/png' }),
    };
    if (includeSource) {
      const frame = frames[frameIndex],
        ratio = Math.min(1, 800 / Math.max(frame.width, frame.height)),
        sourceWidth = Math.max(1, Math.round(frame.width * ratio)),
        sourceHeight = Math.max(1, Math.round(frame.height * ratio)),
        sourceCanvas = makeCanvas(sourceWidth, sourceHeight);
      sourceCanvas.getContext('2d').drawImage(frame, 0, 0, sourceWidth, sourceHeight);
      result.sourceBlob = await sourceCanvas.convertToBlob({ type: 'image/png' });
      result.sourceWidth = sourceWidth;
      result.sourceHeight = sourceHeight;
    }
    return result;
  }
  const formatFallbacks = (requested) =>
    requested === 'gif'
      ? ['gif', 'webp']
      : requested === 'webp'
        ? ['webp', 'gif']
        : ['avif', 'webp', 'gif'];
  async function renderAnimated(
    size,
    state,
    preset,
    mode,
    range,
    height = size,
    requested = 'gif',
  ) {
    const rendered = renderFrames(size, state, preset, range, height),
      posterCanvas = makeCanvas(size, height),
      posterContext = posterCanvas.getContext('2d'),
      limit = preset.animatedLimit || preset.limit,
      attempts =
        mode === 'sticker'
          ? [
              { step: 1, q: 8 },
              { step: 2, q: 8 },
              { step: 2, q: 16 },
              { step: 3, q: 16 },
              { step: 4, q: 24 },
              { step: 6, q: 32 },
            ]
          : [1, 1.25, 1.5, 2, 3, 4, 6, 8].flatMap((step) =>
              [256, 128, 64, 32, 16].map((p) => ({ step, p })),
            );
    posterContext.putImageData(new ImageData(rendered.rgba[0], size, height), 0, 0);
    const poster = await posterCanvas.convertToBlob({ type: 'image/png' });
    const formats =
      mode === 'seventv' ? formatFallbacks(requested) : [mode === 'sticker' ? 'apng' : 'gif'];
    for (const format of formats) {
      // No browser currently exposes animated AVIF encoding. Keep it first in the fallback
      // order so native support can be added without changing the UI contract.
      if (format === 'avif') continue;
      for (const attempt of attempts) {
        const rgba = [],
          frameDelays = [];
        for (let k = 0; Math.floor(k * attempt.step) < rendered.rgba.length; k++) {
          const i = Math.floor(k * attempt.step),
            end = Math.min(rendered.rgba.length, Math.floor((k + 1) * attempt.step));
          rgba.push(rendered.rgba[i]);
          let delay = 0;
          for (let j = i; j < end; j++) delay += rendered.selectedDelays[j];
          frameDelays.push(delay);
        }
        if (rgba.length < 2) continue;
        let encoded;
        try {
          encoded =
            format === 'webp'
              ? {
                  bytes: await encodeAnimatedWebp(
                    rgba,
                    size,
                    height,
                    frameDelays,
                    Math.max(0.35, Math.min(0.92, (attempt.p || 128) / 278)),
                  ),
                  frames: rgba.length,
                  duration: frameDelays.reduce((a, b) => a + b, 0),
                }
              : mode === 'sticker'
                ? await encodeApng(rgba, size, height, frameDelays, attempt.q)
                : encodeGif(rgba, size, height, frameDelays, attempt.p);
        } catch {
          continue;
        }
        const bytes = encoded.bytes;
        if (bytes.length <= limit && encoded.frames <= (preset.maxFrames || 1000)) {
          const label = format.toUpperCase(),
            type = format === 'apng' ? 'image/png' : `image/${format}`;
          return {
            size,
            width: size,
            height,
            bytes: bytes.length,
            limit,
            blob: new Blob([bytes], { type }),
            poster,
            format: label,
            fallbackFrom: mode === 'seventv' && format !== requested ? requested.toUpperCase() : '',
            extension: format === 'apng' ? 'png' : format,
            frames: encoded.frames,
            duration: encoded.duration,
          };
        }
      }
    }
    throw new Error(
      'This animation cannot fit the destination file-size limit. Shorten it or simplify the artwork.',
    );
  }
  function limitAspectRatio(width, height) {
    const roundedWidth = Math.max(1, Math.round(width)),
      roundedHeight = Math.max(1, Math.round(height));
    if (roundedWidth >= roundedHeight * 3) return [roundedHeight * 3 - 1, roundedHeight];
    if (roundedHeight >= roundedWidth * 3) return [roundedWidth, roundedWidth * 3 - 1];
    return [roundedWidth, roundedHeight];
  }
  async function render(mode, state, range, requestedFormat = 'avif') {
    if (!frames.length) throw new Error('Import media first.');
    const preset = presets[mode];
    if (!preset) throw new Error('Unknown destination.');
    checkState(state);
    const original = state.trim ? bounds : { w: frames[0].width, h: frames[0].height },
      source = {
        w: original.w * ((state.width ?? 100) / 100),
        h: original.h * ((state.stretch ?? 100) / 100),
      },
      ratio = Math.min(1, 1000 / Math.max(source.w, source.h)),
      dimensions =
        mode === 'seventv'
          ? [limitAspectRatio(source.w * ratio, source.h * ratio)]
          : preset.sizes.map((size) => [size, size]);
    const outputs = [];
    for (const [size, height] of dimensions) {
      if (animated) {
        outputs.push(
          await renderAnimated(
            size,
            state,
            preset,
            mode,
            range,
            height,
            mode === 'seventv' ? requestedFormat : mode === 'sticker' ? 'apng' : 'gif',
          ),
        );
        continue;
      }
      const canvas = makeCanvas(size, height),
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      drawArtwork(ctx, frames[0], state, size, bounds, makeCanvas, height);
      const rgba = ctx.getImageData(0, 0, size, height).data;
      if (!visible(rgba))
        throw new Error(
          'The artwork is outside the canvas. Use Center image or Fit to bring it back.',
        );
      let blob,
        format = 'PNG',
        extension = 'png',
        fallbackFrom = '';
      for (const candidate of mode === 'seventv' ? formatFallbacks(requestedFormat) : ['png']) {
        if (candidate === 'gif') {
          const encoded = encodeGif([rgba], size, height, [100], 256);
          blob = new Blob([encoded.bytes], { type: 'image/gif' });
        } else {
          blob = await canvas.convertToBlob({
            type: `image/${candidate}`,
            quality: candidate === 'avif' ? 0.82 : 0.9,
          });
          if (blob.type !== `image/${candidate}`) continue;
        }
        if (blob.size <= preset.limit) {
          format = candidate.toUpperCase();
          extension = candidate;
          fallbackFrom = candidate !== requestedFormat ? requestedFormat.toUpperCase() : '';
          break;
        }
        blob = null;
      }
      if (!blob) throw new Error('This export could not meet the destination requirements.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!visible(rgba) || blob.size > preset.limit)
        throw new Error(
          'This export could not meet the destination requirements. Try a simpler crop.',
        );
      outputs.push({
        size,
        width: size,
        height,
        bytes: blob.size,
        limit: preset.limit,
        blob,
        format,
        fallbackFrom,
        extension,
        frames: 1,
        duration: 0,
      });
    }
    return outputs;
  }
  let queue = Promise.resolve();
  self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
      try {
        let result;
        if (data.action === 'load')
          result = await load(data.file, (progress) => self.postMessage({ id: data.id, progress }));
        else if (data.action === 'loadVideo')
          result = await loadVideo(data.videoFrames, data.frameDelays, data.details);
        else if (data.action === 'previewFrame')
          result = await previewFrame(
            data.index,
            data.state,
            data.size,
            data.height,
            data.includeSource,
          );
        else if (data.action === 'render')
          result = await render(data.mode, data.state, data.range, data.format);
        else if (data.action === 'all') {
          result = {};
          for (const mode of Object.keys(presets))
            result[mode] = await render(
              mode,
              data.states[mode],
              data.ranges?.[mode] ?? data.range,
              data.formats?.[mode],
            );
        } else throw new Error('Unknown operation.');
        self.postMessage({ id: data.id, result });
      } catch (error) {
        self.postMessage({ id: data.id, error: error.message || 'Image processing failed.' });
      }
    });
  };
}
class EmoteEngine {
  constructor() {
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap)
      throw new Error('This editor needs a current browser with background canvas support.');
    this.pending = new Map();
    this.next = 1;
    this.url = URL.createObjectURL(
      new Blob([drawArtwork.toString(), '\n(', imageWorker.toString(), ')();'], {
        type: 'text/javascript',
      }),
    );
    this.worker = new Worker(this.url);
    this.worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      if (data.progress) {
        task.onProgress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
    };
    this.worker.onerror = () => {
      for (const task of this.pending.values())
        task.reject(
          new Error('Background processing stopped. Reload the editor and try a smaller image.'),
        );
      this.pending.clear();
    };
  }
  request(action, args = {}, transfer = [], onProgress) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      this.pending.set(id, { resolve, reject, onProgress });
      try {
        this.worker.postMessage({ id, action, ...args }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async decodeMp4(file, onProgress = () => {}) {
    if (!file.size) throw new Error('This file is empty. Choose an MP4 with content.');
    if (file.size > 100 * 1024 * 1024)
      throw new Error('This file is larger than the 100 MB import limit. Choose a smaller MP4.');
    const url = URL.createObjectURL(file),
      video = document.createElement('video'),
      bitmaps = [];
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    const waitFor = (event, errorText) =>
      new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          video.removeEventListener(event, done);
          video.removeEventListener('error', failed);
        };
        const done = () => {
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(new Error(errorText));
        };
        video.addEventListener(event, done, { once: true });
        video.addEventListener('error', failed, { once: true });
        timer = setTimeout(failed, 15000);
      });
    try {
      const metadataReady = waitFor(
        'loadedmetadata',
        'The MP4 metadata could not be read. The video may be damaged or use an unsupported codec.',
      );
      video.load();
      await metadataReady;
      if (
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        !video.videoWidth ||
        !video.videoHeight
      )
        throw new Error('The MP4 duration or dimensions could not be read.');
      if (
        video.videoWidth * video.videoHeight > 48 * 1000 * 1000 ||
        Math.max(video.videoWidth, video.videoHeight) > 20000
      )
        throw new Error('This video exceeds the 48-megapixel / 20,000-pixel-side limit.');
      if (video.readyState < 2)
        await waitFor(
          'loadeddata',
          'The MP4 frames could not be decoded. The codec may not be supported by this browser.',
        );
      const duration = video.duration,
        originalFrames = Math.max(2, Math.ceil(duration * 30)),
        frameCount = Math.max(2, Math.min(240, originalFrames)),
        ratio = Math.min(1, 512 / Math.max(video.videoWidth, video.videoHeight)),
        width = Math.max(1, Math.round(video.videoWidth * ratio)),
        height = Math.max(1, Math.round(video.videoHeight * ratio)),
        canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d', { alpha: false });
      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const seek = (time) =>
        new Promise((resolve, reject) => {
          let timer;
          const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener('seeked', done);
            video.removeEventListener('error', failed);
          };
          const done = () => {
            cleanup();
            resolve();
          };
          const failed = () => {
            cleanup();
            reject(new Error('A frame could not be decoded from this MP4.'));
          };
          video.addEventListener('seeked', done, { once: true });
          video.addEventListener('error', failed, { once: true });
          timer = setTimeout(failed, 10000);
          video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001));
        });
      onProgress({ phase: 'decode', current: 0, total: frameCount });
      for (let index = 0; index < frameCount; index++) {
        await seek(((index + 0.5) / frameCount) * duration);
        ctx.drawImage(video, 0, 0, width, height);
        bitmaps.push(await createImageBitmap(canvas));
        if ((index + 1) % 4 === 0 || index + 1 === frameCount)
          onProgress({ phase: 'decode', current: index + 1, total: frameCount });
      }
      const frameDelay = (duration * 1000) / frameCount,
        frameDelays = Array(frameCount).fill(frameDelay),
        details = {
          width: video.videoWidth,
          height: video.videoHeight,
          bytes: file.size,
          originalFrames,
          sampled: frameCount < originalFrames,
        };
      return await this.request(
        'loadVideo',
        { videoFrames: bitmaps, frameDelays, details },
        bitmaps,
      );
    } catch (error) {
      for (const bitmap of bitmaps)
        try {
          bitmap.close();
        } catch {}
      throw error;
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  call(action, args = {}, onProgress) {
    if (
      action === 'load' &&
      args.file &&
      (args.file.type === 'video/mp4' || /\.mp4$/i.test(args.file.name || ''))
    )
      return this.decodeMp4(args.file, onProgress);
    return this.request(action, args, [], onProgress);
  }
  close() {
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}
window.EmoteEngine = EmoteEngine;
window.drawArtwork = drawArtwork;
