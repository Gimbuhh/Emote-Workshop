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
        return c.width === 800 && c.height === 197;
      });
      await page.waitForFunction(() =>
        document.querySelector('#output-list').textContent.includes('520 \u00d7 128'),
      );
      await page.click('#undo');
      assert.equal(await page.locator('#width-value').inputValue(), '100');
      await page.click('#redo');
      assert.equal(await page.locator('#width-value').inputValue(), '200');
      await page.click('[data-reset-slider="width"]');
      assert.equal(await page.locator('#width-value').inputValue(), '100');
      assert.deepEqual(errors, []);
      console.log(`${file}: rectangular dragging and snapping OK`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
