#!/usr/bin/env node
// Export print-ready files for the Reliable Solutions VI business card and scan sign.
//
// Usage (from anywhere):  node business-card/tools/export.js
// One-time setup:         cd business-card/tools && npm install   (pdf-lib; Playwright must be available)
//
// Writes to business-card/exports/:
//   business-card.pdf      2 pages (front, back), 3.75 x 2.25 in incl. 0.125 in bleed, vector
//   card-front.png         600 DPI with bleed  (2250 x 1350 px)
//   card-back.png          600 DPI with bleed  (2250 x 1350 px)
//   card-front-trim.png    600 DPI trimmed to 3.5 x 2 in (2100 x 1200 px)
//   card-back-trim.png     600 DPI trimmed to 3.5 x 2 in (2100 x 1200 px)
//   scan-sign.pdf          1 page, 5 x 7 in, vector
//   scan-sign.png          300 DPI (1500 x 2100 px)
//
// Pages are rendered with print media emulation so the on-screen preview styling
// (backdrop, shadow, centering) is not applied.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'exports');
const CSS_DPI = 96;

const CARD = { w: 3.75, h: 2.25, bleed: 0.125 }; // inches
const SIGN = { w: 5, h: 7 };

const url = (f) => pathToFileURL(path.join(ROOT, f)).href;

async function openPage(browser, file, wIn, hIn, scale) {
  const page = await browser.newPage({
    viewport: { width: Math.round(wIn * CSS_DPI), height: Math.round(hIn * CSS_DPI) },
    deviceScaleFactor: scale,
  });
  await page.emulateMedia({ media: 'print' });
  await page.goto(url(file), { waitUntil: 'networkidle', timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);
  // Make sure every image has decoded (logo PNG / SVG data, if any).
  await page.evaluate(() =>
    Promise.all(Array.from(document.images).map((img) => (img.decode ? img.decode().catch(() => {}) : null)))
  );
  await page.waitForTimeout(200);
  return page;
}

// Stamp a PNG with pHYs DPI metadata (Chromium screenshots carry none), so print
// shops and image editors read 600 / 300 DPI instead of the 72/96 default.
function setPngDpi(file, dpi) {
  const buf = fs.readFileSync(file);
  const ppm = Math.round(dpi / 0.0254);
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0); data.writeUInt32BE(ppm, 4); data.writeUInt8(1, 8); // unit: metre
  const type = Buffer.from('pHYs');
  const chunk = Buffer.alloc(12 + 9);
  chunk.writeUInt32BE(9, 0); type.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0, 17);
  // Drop any existing pHYs, then insert ours right after IHDR (8-byte signature + 25-byte IHDR).
  const parts = [buf.subarray(0, 33), chunk];
  for (let off = 33; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    const end = off + 12 + len;
    if (buf.toString('latin1', off + 4, off + 8) !== 'pHYs') parts.push(buf.subarray(off, end));
    off = end;
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}

async function pdfOf(page) {
  return page.pdf({ preferCSSPageSize: true, printBackground: true });
}

async function exportCardSide(browser, side) {
  const file = `card-${side}.html`;
  const page = await openPage(browser, file, CARD.w, CARD.h, 600 / CSS_DPI); // 6.25
  const W = CARD.w * CSS_DPI, H = CARD.h * CSS_DPI, B = CARD.bleed * CSS_DPI;
  const full = path.join(OUT, `card-${side}.png`);
  const trim = path.join(OUT, `card-${side}-trim.png`);
  await page.screenshot({ path: full, clip: { x: 0, y: 0, width: W, height: H } });
  await page.screenshot({ path: trim, clip: { x: B, y: B, width: W - 2 * B, height: H - 2 * B } });
  setPngDpi(full, 600);
  setPngDpi(trim, 600);
  const pdf = await pdfOf(page);
  await page.close();
  return pdf;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    // Business card: front + back -> one 2-page PDF.
    const frontPdf = await exportCardSide(browser, 'front');
    const backPdf = await exportCardSide(browser, 'back');
    const merged = await PDFDocument.create();
    merged.setTitle('Reliable Solutions VI - Business Card (3.5 x 2 in + 0.125 in bleed)');
    merged.setAuthor('Reliable Solutions VI');
    for (const bytes of [frontPdf, backPdf]) {
      const src = await PDFDocument.load(bytes);
      if (src.getPageCount() !== 1) throw new Error(`expected 1 page per card side, got ${src.getPageCount()}`);
      const [p] = await merged.copyPages(src, [0]);
      // Tell print-shop preflight where the trim is: 0.125in (9pt) bleed on every side.
      const { width, height } = p.getSize();
      p.setBleedBox(0, 0, width, height);
      p.setTrimBox(9, 9, width - 18, height - 18);
      merged.addPage(p);
    }
    fs.writeFileSync(path.join(OUT, 'business-card.pdf'), await merged.save());

    // Scan sign: 5 x 7 in PDF + 300 DPI PNG.
    const sign = await openPage(browser, 'scan-sign.html', SIGN.w, SIGN.h, 300 / CSS_DPI); // 3.125
    const signPng = path.join(OUT, 'scan-sign.png');
    await sign.screenshot({ path: signPng, clip: { x: 0, y: 0, width: SIGN.w * CSS_DPI, height: SIGN.h * CSS_DPI } });
    setPngDpi(signPng, 300);
    const signPdf = await PDFDocument.load(await pdfOf(sign));
    if (signPdf.getPageCount() !== 1) throw new Error(`scan-sign.pdf has ${signPdf.getPageCount()} pages`);
    signPdf.setTitle('Reliable Solutions VI - Scan to Save Contact (5 x 7 in)');
    fs.writeFileSync(path.join(OUT, 'scan-sign.pdf'), await signPdf.save());
    await sign.close();
  } finally {
    await browser.close();
  }
  for (const f of ['business-card.pdf', 'card-front.png', 'card-back.png', 'card-front-trim.png',
    'card-back-trim.png', 'scan-sign.pdf', 'scan-sign.png']) {
    const s = fs.statSync(path.join(OUT, f)).size;
    console.log(`${f.padEnd(22)} ${(s / 1024).toFixed(1)} KB`);
  }
}

main().catch((e) => { console.error(e.stack || e); process.exit(1); });
