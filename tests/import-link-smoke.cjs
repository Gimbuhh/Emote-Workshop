const launchBrowser = require('./browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function makeGifFixture() {
  const engine = readFileSync(path.resolve('dist/engine.js'), 'utf8'),
    anchor = /let queue\s*=\s*Promise\.resolve\(\);/;
  assert(anchor.test(engine), 'Worker test anchor missing');
  const source = engine.replace(anchor, 'self.test={encodeGif};let queue=Promise.resolve();'),
    context = { self: {}, window: {}, TextEncoder, Uint8Array, Uint32Array, Float64Array };
  vm.runInNewContext(`${source}\nimageWorker();`, context);
  const frames = [new Uint8Array(16 * 16 * 4), new Uint8Array(16 * 16 * 4)];
  for (let p = 0; p < frames[0].length; p += 4) {
    frames[0].set([123, 63, 201, 255], p);
    frames[1].set([239, 147, 53, 255], p);
  }
  return Buffer.from(context.self.test.encodeGif(frames, 16, 16, [100, 100], 16).bytes);
}

const avifFixture = readFileSync(path.resolve('tests/fixtures/still.avif')),
  gifFixture = makeGifFixture();

(async () => {
  const browser = await launchBrowser();
  try {
    for (const file of ['dist/index.html', 'Emote Workshop.html']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const requested = [];
      await page.route('https://cdn.7tv.app/**', async (route) => {
        requested.push(route.request().url());
        if (route.request().url().endsWith('.avif'))
          await route.fulfill({ status: 200, contentType: 'image/avif', body: avifFixture });
        else if (route.request().url().endsWith('.gif'))
          await route.fulfill({ status: 200, contentType: 'image/gif', body: gifFixture });
        else await route.fulfill({ status: 404 });
      });
      await page.goto(pathToFileURL(path.resolve(file)).href);
      await page.click('#empty-import');
      assert.equal(await page.locator('#import-dialog').getAttribute('open'), '');
      assert.equal(await page.locator('#seventv-size').inputValue(), '4');
      assert.equal(await page.locator('#seventv-format').inputValue(), 'avif');
      await page.locator('#seventv-link').fill('https://7tv.app/emotes/01F6MQ33FG000FFJ97ZB8MWV52');
      await page.click('#import-seventv');
      await page.waitForFunction(() => !document.querySelector('#editor-canvas').hidden);
      assert.deepEqual(requested, ['https://cdn.7tv.app/emote/01F6MQ33FG000FFJ97ZB8MWV52/4x.avif']);
      assert.match(await page.locator('#source-name').textContent(), /^7tv_.*\.avif$/);
      assert.equal(await page.locator('#import-dialog').isVisible(), false);
      await page.click('#replace');
      await page.locator('#seventv-link').fill('https://7tv.app/emotes/01F6MQ33FG000FFJ97ZB8MWV52');
      await page.locator('#seventv-size').selectOption('2');
      await page.locator('#seventv-format').selectOption('gif');
      await page.click('#import-seventv');
      await page.waitForFunction(
        () =>
          document.querySelector('#source-name').textContent.endsWith('.gif') ||
          document.querySelector('#link-import-status').classList.contains('error'),
      );
      assert.match(
        await page.locator('#source-name').textContent(),
        /\.gif$/,
        await page.locator('#link-import-status').textContent(),
      );
      assert.equal(requested.at(-1), 'https://cdn.7tv.app/emote/01F6MQ33FG000FFJ97ZB8MWV52/2x.gif');
      assert.equal(await page.locator('#import-dialog').isVisible(), false);
      assert.deepEqual(errors, []);
      console.log(file, '7TV 4x AVIF default and size/format selection passed');
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
