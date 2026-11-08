#!/usr/bin/env node
// Render a URL or local file (HTML/SVG) to a PNG screenshot with headless Chromium.
// Usage: node tools/render.js <url-or-path> <out.png> <width> <height> [scale=2] [--full]
//   width/height are CSS px (for print pages pass @page size in inches x 96).
//   --full captures the full scrollable page instead of just the viewport.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const [target, out, w, h, s] = args.filter((a) => a !== '--full');
  if (!target || !out || !w || !h) {
    console.error('usage: render.js <url-or-path> <out.png> <width> <height> [scale] [--full]');
    process.exit(2);
  }
  const url = /^[a-z]+:\/\//i.test(target) ? target : pathToFileURL(path.resolve(target)).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: Math.round(+w), height: Math.round(+h) },
      deviceScaleFactor: s ? +s : 2,
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
    await page.waitForTimeout(150);
    await page.screenshot({ path: out, fullPage: full });
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
