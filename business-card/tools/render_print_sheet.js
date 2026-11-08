// Render print-sheet.html to exports/print-sheet-letter.pdf. Run build_print_sheet.py first.
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'print-sheet.html');
const PDF = path.join(ROOT, 'exports', 'print-sheet-letter.pdf');
const OUT = process.argv[2]; // optional dir for page screenshots
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 4 });
  await page.goto(pathToFileURL(SRC).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: PDF, preferCSSPageSize: true, printBackground: true });
  const secs = await page.$$('.sheet');
  if (OUT) for (let i = 0; i < secs.length; i++) await secs[i].screenshot({ path: `${OUT}/page${i + 1}.png` });
  console.log('fonts:', await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight + ' ' + f.style).join(', ')));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
