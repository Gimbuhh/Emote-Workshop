const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await launchBrowser();
  try {
    for (const file of ['dist/index.html', 'Emote Workshop.html']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
        errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(file)).href);
      await page.click('#sample');
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      const value = (key) => page.locator(`#${key}`).inputValue();
      const scroll = async (key, deltaY, expected) => {
        await page.locator(`#${key}`).hover();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await page.mouse.wheel(0, deltaY);
        await page.waitForFunction(
          ({ key, expected }) => document.getElementById(key).value === String(expected),
          { key, expected },
        );
        assert.equal(await page.locator(`#${key}-value`).inputValue(), String(expected));
        assert.equal(await page.evaluate(() => window.scrollY), scrollBefore);
      };
      assert.equal(await value('zoom'), '90');
      await scroll('zoom', -120, 91);
      assert.equal(
        await page.locator('#zoom').evaluate((el) => el === document.activeElement),
        false,
      );
      await scroll('zoom', 120, 90);
      await scroll('width', -100, 101);
      await page.click('#undo');
      assert.equal(await value('width'), '100');
      await page.click('#redo');
      assert.equal(await value('width'), '101');
      await scroll('stretch', -120, 101);
      await scroll('brightness', -120, 101);
      await scroll('rotation', -120, 1);
      await scroll('outline', -120, 0.5);

      // Browser WheelEvents reproduce the small deltas of a precision trackpad.
      await page.locator('#zoom').hover();
      const trackpad = await page.locator('#zoom').evaluate((el) => {
        const values = [];
        for (const deltaY of [-20, -20, -20, -20]) {
          const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
          el.dispatchEvent(event);
          values.push({ value: el.value, prevented: event.defaultPrevented });
        }
        return values;
      });
      assert.deepEqual(
        trackpad.map((step) => step.value),
        ['90', '90', '90', '91'],
      );
      assert(trackpad.every((step) => step.prevented));
      await page.click('#platform-twitch');
      assert.equal(await value('zoom'), '90', 'Destination settings stay independent');
      await scroll('zoom', -120, 91);
      await page.click('#platform-discord');
      assert.equal(await value('width'), '101');
      await page.click('#auto-fill');
      const beforeScale = Number(await value('zoom'));
      await scroll('width', -120, 102);
      assert.notEqual(
        Number(await value('zoom')),
        beforeScale,
        'Auto-fill responds to wheel stretching',
      );
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      await page.click('#compare-toggle');
      assert.equal((await page.locator('#converted-preview').getAttribute('src')) !== null, true);
      await page.locator('#file-input').setInputFiles(path.resolve('tests/fixtures/animated.avif'));
      await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
      const framesBefore = [await value('start-frame'), await value('end-frame')];
      await scroll('speed', -120, 101);
      assert.deepEqual([await value('start-frame'), await value('end-frame')], framesBefore);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${file}: hover wheel, trackpad, page position, undo/redo, and auto-fill OK`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
