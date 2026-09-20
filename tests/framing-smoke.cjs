const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await launchBrowser();
  try {
    for (const file of ['dist/index.html', 'Emote Workshop.html']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(file)).href);
      const version = require('../package.json').version,
        displayVersion = version.endsWith('.0') ? version.slice(0, -2) : version,
        versionLink = page.locator('.version-link');
      assert.equal(await versionLink.textContent(), `v${displayVersion}`);
      assert.equal(
        await versionLink.getAttribute('href'),
        'https://github.com/Gimbuhh/Emote-Workshop/blob/main/CHANGELOG.md',
      );
      assert.equal(await versionLink.getAttribute('target'), '_blank');
      assert.equal(await versionLink.getAttribute('rel'), 'noopener noreferrer');
      const repoLink = page.locator('.repo-link');
      assert.equal(await repoLink.textContent(), 'GitHub');
      assert.equal(
        await repoLink.getAttribute('href'),
        'https://github.com/Gimbuhh/Emote-Workshop',
      );
      assert.equal(await repoLink.locator('svg').count(), 1);
      for (const width of [1280, 375, 320]) {
        await page.setViewportSize({ width, height: 800 });
        assert.equal(await versionLink.isVisible(), true);
        const linkBox = await versionLink.boundingBox();
        const actionBox = await page.locator('.header-actions').boundingBox();
        assert(linkBox.x >= 0 && linkBox.x + linkBox.width <= actionBox.x);
        assert(actionBox.x + actionBox.width <= width);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.click('#platform-seventv');
      const bytes = await page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 260;
        c.height = 128;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#7b3fc9';
        ctx.fillRect(100, 48, 40, 30);
        const blob = await new Promise((resolve) => c.toBlob(resolve));
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      });
      await page.locator('#file-input').setInputFiles({
        name: 'framing.png',
        mimeType: 'image/png',
        buffer: Buffer.from(bytes),
      });
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      assert.match(await page.locator('#original-bytes').textContent(), /^PNG · /);
      assert.match(await page.locator('#result-bytes').textContent(), /^PNG · /);
      assert.match(await page.locator('#size-change').textContent(), /smaller|larger|same size/);
      await page.click('#compare-toggle');
      assert.equal(await page.locator('#compare-toggle').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.original-pane').isVisible(), true);
      assert.equal(await page.locator('#converted-pane').isVisible(), true);
      assert.match(await page.locator('#compare-original-meta').textContent(), /^PNG · /);
      assert.match(await page.locator('#compare-converted-meta').textContent(), /^PNG · /);
      assert.match(await page.locator('#converted-preview').getAttribute('src'), /^blob:/);
      assert.equal(await page.locator('#converted-preview').getAttribute('draggable'), 'false');
      assert.equal(
        await page.locator('#converted-preview').evaluate((image) => {
          const event = new DragEvent('dragstart', {
            bubbles: true,
            cancelable: true,
            dataTransfer: new DataTransfer(),
          });
          image.dispatchEvent(event);
          return event.defaultPrevented;
        }),
        true,
      );
      assert.equal(await page.locator('#original-compare-canvas').isVisible(), true);
      const originalBefore = await page
        .locator('#original-compare-canvas')
        .evaluate((canvas) => canvas.toDataURL());
      await page.locator('#width-value').fill('270');
      await page.locator('#width-value').press('Enter');
      assert.equal(await page.locator('#converted-live-preview').isVisible(), true);
      assert.equal(await page.locator('#converted-preview').isVisible(), false);
      assert.equal(
        await page.locator('#converted-live-preview').evaluate((canvas) => canvas.toDataURL()),
        await page.locator('#editor-canvas').evaluate((canvas) => canvas.toDataURL()),
        'Compare mirrors the live transformed canvas while the encoded output catches up',
      );
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      assert.equal(
        await page.locator('#original-compare-canvas').evaluate((canvas) => canvas.toDataURL()),
        originalBefore,
        'Compare keeps the original source unchanged after framing edits',
      );
      await page.locator('#width-value').fill('100');
      await page.locator('#width-value').press('Enter');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.setViewportSize({ width: 375, height: 800 });
      await page.click('#compare-original');
      assert.equal(await page.locator('.original-pane').isVisible(), true);
      assert.equal(await page.locator('#converted-pane').isVisible(), false);
      await page.click('#compare-converted');
      assert.equal(await page.locator('.original-pane').isVisible(), false);
      assert.equal(await page.locator('#converted-pane').isVisible(), true);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.click('#compare-toggle');
      const centroid = () =>
        page.locator('#editor-canvas').evaluate((c) => {
          const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let x = 0,
            y = 0,
            mass = 0;
          for (let i = 0; i < rgba.length; i += 4) {
            const alpha = rgba[i + 3];
            x += ((i / 4) % c.width) * alpha;
            y += Math.floor(i / 4 / c.width) * alpha;
            mass += alpha;
          }
          const rect = c.getBoundingClientRect();
          return { x: (x / mass / c.width) * rect.width, y: (y / mass / c.height) * rect.height };
        });
      const canvas = page.locator('#editor-canvas');
      await canvas.scrollIntoViewIfNeeded();
      const rect = await canvas.boundingBox();
      const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const drag = async (x, y) => {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + x, start.y + y);
        await page.mouse.up();
      };
      const before = await centroid();
      await drag(30, 24);
      const after = await centroid();
      assert(Math.abs(after.x - before.x - 30) < 1);
      assert(Math.abs(after.y - before.y - 24) < 1);
      await page.click('#center');
      await drag(0, 8);
      const outsideSnap = await centroid();
      assert(Math.abs(outsideSnap.y - before.y - 8) < 1, '8px must not snap to center');
      await page.click('#center');
      await drag(0, 5);
      const insideSnap = await centroid();
      assert(Math.abs(insideSnap.y - before.y) < 1, '5px must snap to center');
      await page.locator('#width-value').fill('200');
      await page.locator('#width-value').press('Enter');
      await page.waitForFunction(() => {
        const c = document.querySelector('#editor-canvas');
        return c.width === 800 && c.height === 267;
      });
      await page.waitForFunction(() =>
        document.querySelector('#output-list').textContent.includes('383 \u00d7 128'),
      );
      await page.click('#undo');
      assert.equal(await page.locator('#width-value').inputValue(), '100');
      await page.click('#redo');
      assert.equal(await page.locator('#width-value').inputValue(), '200');
      await page.click('[data-reset-slider="width"]');
      assert.equal(await page.locator('#width-value').inputValue(), '100');
      await page.click('#platform-discord');
      await page.click('#auto-fill');
      assert.equal(await page.locator('#auto-fill').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#zoom-value').inputValue(), '203');
      await page.locator('#width-value').fill('200');
      await page.locator('#width-value').press('Enter');
      assert.equal(await page.locator('#zoom-value').inputValue(), '300');
      await page.click('#auto-fill');
      await page.click('[data-reset-slider="width"]');
      await page.click('#fit');
      await page.click('#platform-seventv');
      await canvas.hover();
      const scrollY = await page.evaluate(() => window.scrollY);
      await page.mouse.wheel(0, -120);
      await page.waitForFunction(() => document.querySelector('#zoom').value === '91');
      assert.equal(await page.locator('#zoom-value').inputValue(), '91');
      assert.equal(await page.evaluate(() => window.scrollY), scrollY);
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => document.querySelector('#zoom').value === '90');
      await page.click('#undo');
      assert.equal(await page.locator('#zoom').inputValue(), '91');
      await page.click('#redo');
      assert.equal(await page.locator('#zoom').inputValue(), '90');
      const wheel = (options) =>
        canvas.evaluate((element, options) => {
          const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        }, options);
      for (const [deltaMode, expected] of [
        [0, 94],
        [1, 95],
        [2, 96],
      ]) {
        assert.equal(await wheel({ deltaY: -500, deltaMode }), true);
        assert.equal(await page.locator('#zoom').inputValue(), String(expected));
      }
      for (let index = 0; index < 79; index++) assert.equal(await wheel({ deltaY: -1 }), true);
      assert.equal(await page.locator('#zoom').inputValue(), '96');
      assert.equal(await wheel({ deltaY: -1 }), true);
      assert.equal(await page.locator('#zoom').inputValue(), '97');
      assert.equal(await wheel({ deltaY: -240 }), true);
      assert.equal(await page.locator('#zoom').inputValue(), '100');
      assert.equal(await wheel({ deltaY: 40 }), true);
      assert.equal(await page.locator('#zoom').inputValue(), '100');
      assert.equal(await wheel({ deltaY: 40 }), true);
      assert.equal(await page.locator('#zoom').inputValue(), '99');
      for (const options of [
        { deltaY: 0, deltaX: 120 },
        { deltaY: -120, ctrlKey: true },
        { deltaY: -120, metaKey: true },
      ]) {
        assert.equal(await wheel(options), false);
        assert.equal(await page.locator('#zoom').inputValue(), '99');
      }
      for (const [limit, deltaY] of [
        [300, -120],
        [10, 120],
      ]) {
        await page.locator('#zoom-value').fill(String(limit));
        await page.locator('#zoom-value').press('Enter');
        assert.equal(await wheel({ deltaY }), true);
        assert.equal(await page.locator('#zoom').inputValue(), String(limit));
        await page.click('#undo');
        assert.equal(await page.locator('#zoom').inputValue(), '99');
      }
      await page.locator('#drop-zone').dispatchEvent('wheel', { deltaY: -120 });
      assert.equal(await page.locator('#zoom').inputValue(), '99');
      await page.click('#platform-discord');
      assert.equal(await page.locator('#zoom').inputValue(), '90');
      await wheel({ deltaY: -120 });
      assert.equal(await page.locator('#zoom').inputValue(), '91');
      await page.click('#platform-seventv');
      assert.equal(await page.locator('#zoom').inputValue(), '99');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.locator('#file-input').setInputFiles(path.resolve('tests/fixtures/animated.avif'));
      await page.waitForFunction(
        () =>
          !document.querySelector('#animation-section').hidden &&
          document.querySelector('#timeline-frames').getAttribute('aria-busy') === 'false',
      );
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.click('#compare-toggle');
      assert.match(await page.locator('#compare-converted-meta').textContent(), /^GIF · /);
      await page.waitForFunction(
        () =>
          !document.querySelector('#original-animated-preview').hidden &&
          document.querySelector('#original-animated-preview').src.startsWith('blob:'),
      );
      await page.click('#editor-animation-toggle');
      assert.equal(await page.locator('#converted-paused').isVisible(), true);
      await page.click('#editor-animation-toggle');
      assert.equal(await page.locator('#converted-preview').isVisible(), true);
      await page.click('#compare-toggle');
      await page.locator('#end-frame-value').fill('2');
      await page.locator('#end-frame-value').press('Enter');
      assert.equal(await page.locator('#start-frame-value').inputValue(), '1');
      assert.equal(await page.locator('#end-frame-value').inputValue(), '2');
      const selection = await page.locator('#trim-range').boundingBox(),
        timeline = await page.locator('#frame-timeline').boundingBox();
      assert(selection && timeline);
      await page.mouse.move(selection.x + selection.width / 2, selection.y + selection.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        selection.x + selection.width / 2 + timeline.width / 3,
        selection.y + selection.height / 2,
      );
      await page.mouse.up();
      assert.equal(await page.locator('#start-frame-value').inputValue(), '2');
      assert.equal(await page.locator('#end-frame-value').inputValue(), '3');
      assert.deepEqual(errors, []);
      console.log(`${file}: framing, precision wheel zoom, and trim range dragging OK`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
