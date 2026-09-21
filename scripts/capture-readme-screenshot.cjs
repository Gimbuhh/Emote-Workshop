const launchBrowser = require('../tests/browser-launch.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(pathToFileURL(path.resolve('dist/index.html')).href);
    await page.click('#sample');
    await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
    await page.click('#platform-seventv');
    await page.click('#auto-fill');
    await page.locator('#width-value').fill('140');
    await page.locator('#width-value').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#export-current').disabled);
    await page.click('#compare-toggle');
    await page.evaluate(() => {
      document.querySelector('#toast').hidden = true;
      document.querySelector('.app-header').scrollIntoView();
    });
    await page.screenshot({
      path: path.resolve('docs/images/emote-workshop-v1.3.png'),
      animations: 'disabled',
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
