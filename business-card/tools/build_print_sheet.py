#!/usr/bin/env python3
"""Build business-card/print-sheet.html: a 2-page US Letter imposition sheet.

Page 1: 10 card FRONTS, page 2: 10 card BACKS, each laid out 2 columns x 5 rows
of 3.5in x 2in cards at trim size, butted edge to edge and centered on the page,
with crop marks in the margins (outside the grid only).

Page 2's columns are mirrored (left <-> right) so that when the sheet is printed
duplex, flipped on the LONG edge, each back lands behind its front.

The two source cards (card-front.html / card-back.html) are 3.75in x 2.25in pages
(3.5 x 2 trim + 0.125in bleed). Their <style> blocks are inlined once, each scoped
under its own wrapper class (.rsvi-f / .rsvi-b) so colliding class names (.card,
.safe, .brand, .rule, h1 ...) cannot leak between sides. Each card is placed in a
3.5 x 2in clipping slot, shifted by -0.125in so the bleed is cropped away and the
trim box fills the slot exactly.

Usage:  python3 business-card/tools/build_print_sheet.py
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # business-card/
FRONT = ROOT / "card-front.html"
BACK = ROOT / "card-back.html"
OUT = ROOT / "print-sheet.html"

# ---- geometry (inches) ------------------------------------------------------
PAGE_W, PAGE_H = 8.5, 11.0
CARD_W, CARD_H = 3.5, 2.0
BLEED = 0.125
COLS, ROWS = 2, 5
GRID_W, GRID_H = COLS * CARD_W, ROWS * CARD_H          # 7.0 x 10.0
MX, MY = (PAGE_W - GRID_W) / 2, (PAGE_H - GRID_H) / 2  # 0.75, 0.5
MARK_GAP, MARK_LEN = 0.0625, 0.25                      # crop-mark offset/length
MARK_STROKE = 0.25 / 72                                # 0.25pt hairline


# ---- CSS scoping -------------------------------------------------------------
def _blocks(css: str):
    """Yield (prelude, body) for each top-level rule; handles nested braces."""
    i, n = 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j < 0:
            break
        prelude = css[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
            k += 1
        yield prelude, css[j + 1:k - 1]
        i = k


def scope_css(css: str, scope: str) -> str:
    """Prefix every selector with `scope`; drop @page and @media screen blocks.

    :root / html / body map onto the scope element itself, `*` onto its
    descendants, so custom properties and inherited font/colour still apply.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = []
    for prelude, body in _blocks(css):
        if prelude.startswith("@"):
            # @page (sheet defines its own), @media screen (single-card preview
            # layout), @import etc. are not wanted inside the sheet.
            continue
        sels = []
        for sel in prelude.split(","):
            sel = sel.strip()
            if sel in (":root", "html", "body"):
                sels.append(scope)
            elif sel.startswith(("html ", "body ")):
                sels.append(f"{scope} {sel.split(' ', 1)[1]}")
            else:
                sels.append(f"{scope} {sel}")
        sels = list(dict.fromkeys(sels))
        body = " ".join(body.split())
        out.append(f"  {', '.join(sels)} {{ {body} }}")
    return "\n".join(out)


def extract(path: Path):
    html = path.read_text(encoding="utf-8")
    css = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", html, flags=re.S))
    m = re.search(r"<main\b(.*?)>(.*)</main>", html, flags=re.S)
    if not m:
        raise SystemExit(f"{path.name}: no <main> card element found")
    attrs, inner = m.group(1), m.group(2)
    ids = re.findall(r'\bid="([^"]+)"', inner)
    return css, attrs, inner.strip(), ids


def instance(attrs: str, inner: str, ids, suffix: str) -> str:
    """One copy of a card, with SVG ids made unique per copy."""
    for i in ids:
        inner = re.sub(rf'\bid="{re.escape(i)}"', f'id="{i}-{suffix}"', inner)
        inner = inner.replace(f"url(#{i})", f"url(#{i}-{suffix})")
        inner = inner.replace(f'href="#{i}"', f'href="#{i}-{suffix}"')
    attrs = re.sub(r'\saria-label="[^"]*"', "", attrs)  # avoid 20 identical landmarks
    return f"<div{attrs} aria-hidden=\"true\">{inner}</div>"


# ---- crop marks --------------------------------------------------------------
def crop_marks_svg() -> str:
    xs = [MX + c * CARD_W for c in range(COLS + 1)]
    ys = [MY + r * CARD_H for r in range(ROWS + 1)]
    lines = []
    for x in xs:  # vertical cut lines: marks above and below the grid
        lines.append((x, MY - MARK_GAP - MARK_LEN, x, MY - MARK_GAP))
        lines.append((x, MY + GRID_H + MARK_GAP, x, MY + GRID_H + MARK_GAP + MARK_LEN))
    for y in ys:  # horizontal cut lines: marks left and right of the grid
        lines.append((MX - MARK_GAP - MARK_LEN, y, MX - MARK_GAP, y))
        lines.append((MX + GRID_W + MARK_GAP, y, MX + GRID_W + MARK_GAP + MARK_LEN, y))
    segs = "".join(
        f'<line x1="{a:.4f}" y1="{b:.4f}" x2="{c:.4f}" y2="{d:.4f}"/>' for a, b, c, d in lines
    )
    return (
        f'<svg class="marks" viewBox="0 0 {PAGE_W} {PAGE_H}" aria-hidden="true">'
        f'<g stroke="#000" stroke-width="{MARK_STROKE:.5f}" fill="none">{segs}</g></svg>'
    )


def sheet(kind: str, scope: str, attrs: str, inner: str, ids, mirror: bool, label: str, notes) -> str:
    slots = []
    for r in range(ROWS):
        for c in range(COLS):
            col = (COLS - 1 - c) if mirror else c  # mirror columns for long-edge duplex
            left, top = MX + col * CARD_W, MY + r * CARD_H
            n = r * COLS + c + 1  # card number = matching front's reading-order index
            slots.append(
                f'<div class="slot" data-card="{n}" style="left:{left}in;top:{top}in">'
                f'<div class="{scope}">{instance(attrs, inner, ids, f"{kind}{n}")}</div></div>'
            )
    return (
        f'<section class="sheet sheet-{kind}" aria-label="{label}">\n'
        + "".join(f'  <p class="note" style="left:{MX + i * CARD_W + 0.15}in">{t}</p>\n' for i, t in enumerate(notes))
        + "  " + "\n  ".join(slots) + f"\n  {crop_marks_svg()}\n</section>"
    )


def main():
    f_css, f_attrs, f_inner, f_ids = extract(FRONT)
    b_css, b_attrs, b_inner, b_ids = extract(BACK)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Print Sheet · Reliable Solutions VI</title>
<!--
  GENERATED by tools/build_print_sheet.py from card-front.html + card-back.html.
  Do not edit by hand; re-run the script after changing either card.

  US Letter, 2 pages: p1 = 10 fronts, p2 = 10 backs (2 x 5, 3.5 x 2in trim,
  butted, grid {GRID_W:g} x {GRID_H:g}in centered -> margins {MX:g}in L/R, {MY:g}in T/B).
  Page 2 columns are mirrored for duplex "flip on long edge".
  Print at 100% / Actual size (no "fit to page"), on cardstock.
-->
<link rel="stylesheet" href="assets/brand.css">
<style>
  @page {{ size: {PAGE_W}in {PAGE_H}in; margin: 0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{ background: #FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  .sheet {{
    position: relative; width: {PAGE_W}in; height: {PAGE_H}in; overflow: hidden;
    background: #FFFFFF; break-after: page; page-break-after: always;
  }}
  .sheet:last-child {{ break-after: auto; page-break-after: auto; }}
  .slot {{ position: absolute; width: {CARD_W}in; height: {CARD_H}in; overflow: hidden; }}
  .slot > div {{ position: absolute; left: -{BLEED}in; top: -{BLEED}in;
                 width: {CARD_W + 2 * BLEED}in; height: {CARD_H + 2 * BLEED}in; }}
  .marks {{ position: absolute; inset: 0; width: {PAGE_W}in; height: {PAGE_H}in; pointer-events: none; }}
  .note {{
    position: absolute; top: {MY / 2 - 0.04}in; width: {CARD_W - 0.3}in; white-space: nowrap;
    font: 500 6pt/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: .04em; color: #64748B;
  }}
  @media screen {{
    body {{ background: #CBD5E1; padding: 24px 0; }}
    .sheet {{ margin: 0 auto 24px; box-shadow: 0 6px 30px rgba(15,23,42,.25); }}
  }}

  /* ---- card-front.html styles, scoped ---- */
{scope_css(f_css, '.rsvi-f')}

  /* ---- card-back.html styles, scoped ---- */
{scope_css(b_css, '.rsvi-b')}
</style>
</head>
<body>
{sheet('f', 'rsvi-f', f_attrs, f_inner, f_ids, False,
       'Fronts (page 1 of 2)',
       ['FRONTS · page 1 of 2 · cut on crop marks', 'Print 100% / Actual size · duplex: flip on LONG edge'])}
{sheet('b', 'rsvi-b', b_attrs, b_inner, b_ids, True,
       'Backs (page 2 of 2, columns mirrored)',
       ['BACKS · page 2 of 2 · columns mirrored', 'Print 100% / Actual size · duplex: flip on LONG edge'])}
</body>
</html>
"""
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
