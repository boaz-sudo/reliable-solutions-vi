#!/usr/bin/env python3
"""QA check for the Reliable Solutions VI QR business card.

Dependencies:
    pip install zxing-cpp Pillow segno      # segno: imported via generate.py
    node + playwright with Chromium         # used by tools/render.js

Run:
    python3 business-card/verify_qr.py [--keep DIR]

What it checks:
  1. Every assets/*.png QR decodes and its payload equals vcard(CONTACT)
     (or tel:<phone> for qr-call*).
  2. Every assets/qr-*.svg, plus HTML pages that carry a QR (card-back.html,
     scan-sign.html, index.html, email-signature.html), is rasterized through
     Chromium (tools/render.js) and decoded. Missing pages print SKIP.
  3. Print robustness per decoded QR: downscaled so the symbol is ~1.1in at
     150dpi (165px), the same plus a slight gaussian blur, grayscale, and all
     three combined.
  4. The .vcf parses and has FN, TEL and EMAIL matching CONTACT.
Exits nonzero if any check fails.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import zxingcpp
    from PIL import Image, ImageFilter, ImageOps
except ImportError as e:  # pragma: no cover
    sys.exit(f"Missing dependency ({e.name}). Run: pip install zxing-cpp Pillow")

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
RENDER_JS = HERE / "tools" / "render.js"
sys.dont_write_bytecode = True  # keep the repo free of __pycache__
sys.path.insert(0, str(HERE))
from generate import CARD_PAGE_URL, CONTACT, vcard  # noqa: E402

VCARD = vcard(CONTACT)
TEL = f"tel:{CONTACT['phone']}"
KNOWN = {VCARD: "vCard", TEL: "tel", CARD_PAGE_URL: "card page URL"}

HTML_PAGES = ["card-back.html", "scan-sign.html", "index.html", "email-signature.html"]
DEFAULT_VIEWPORT = (1280, 900)          # screen pages without an @page size
PRINT_DPI, PRINT_INCHES = 150, 1.1      # smallest realistic printed QR size
PRINT_PX = round(PRINT_DPI * PRINT_INCHES)  # 165 px across the symbol
BLUR_RADIUS = 0.8                        # px at 150dpi ~ 0.14mm ink spread
RENDER_SCALE = 2

results: list[tuple[str, str, str, str]] = []  # (target, variant, status, detail)


def record(target: str, variant: str, status: str, detail: str = "") -> None:
    results.append((target, variant, status, detail))
    if status == "SKIP":
        print(f"SKIP  {target}: {detail}")


def short(payload: str) -> str:
    if payload in KNOWN:
        return KNOWN[payload]
    s = payload.replace("\r", "\\r").replace("\n", "\\n")
    return repr(s[:60] + ("..." if len(s) > 60 else ""))


def expected_for(name: str) -> str:
    if "card-page" in name.lower():
        return CARD_PAGE_URL
    return TEL if "call" in name.lower() else VCARD


def flatten(img: Image.Image) -> Image.Image:
    """Composite transparency onto white (as paper would) and return RGB."""
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    return img.convert("RGB")


def decode(img: Image.Image):
    return [b for b in zxingcpp.read_barcodes(img) if b.format == zxingcpp.BarcodeFormat.QRCode]


def bbox(b) -> tuple[int, int, int, int]:
    p = b.position
    xs = [p.top_left.x, p.top_right.x, p.bottom_right.x, p.bottom_left.x]
    ys = [p.top_left.y, p.top_right.y, p.bottom_right.y, p.bottom_left.y]
    return min(xs), min(ys), max(xs), max(ys)


def crop_with_margin(img: Image.Image, box, frac: float = 0.15) -> Image.Image:
    """Crop one QR plus its real surroundings (quiet zone or whatever the design put there)."""
    x0, y0, x1, y1 = box
    m = int(max(x1 - x0, y1 - y0) * frac) + 2
    return img.crop((max(0, x0 - m), max(0, y0 - m), min(img.width, x1 + m), min(img.height, y1 + m)))


def variants(crop: Image.Image, symbol_px: int):
    f = PRINT_PX / max(symbol_px, 1)
    small = crop.resize((max(1, round(crop.width * f)), max(1, round(crop.height * f))), Image.LANCZOS)
    blurred = small.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
    yield f"print {PRINT_INCHES}in@{PRINT_DPI}dpi", small
    yield f"+blur r{BLUR_RADIUS}", blurred
    yield "grayscale", ImageOps.grayscale(crop)
    yield "print+blur+gray", ImageOps.grayscale(blurred)


def check_image(target: str, img: Image.Image, expected: set[str], require: str | None) -> None:
    """Decode an image, check every payload, then stress-test each QR found."""
    img = flatten(img)
    found = decode(img)
    if not found:
        record(target, "original", "FAIL", "no QR code decoded")
        return
    payloads = [b.text for b in found]
    bad = [p for p in payloads if p not in expected]
    if bad:
        record(target, "original", "FAIL", f"unexpected payload {short(bad[0])}")
    elif require and require not in payloads:
        record(target, "original", "FAIL", f"found {', '.join(map(short, payloads))} but no {KNOWN[require]} QR")
    else:
        record(target, "original", "PASS", f"{len(found)} QR: {', '.join(map(short, payloads))}")
    for i, b in enumerate(found):
        x0, y0, x1, y1 = bbox(b)
        sym = max(x1 - x0, y1 - y0)
        label = target if len(found) == 1 else f"{target} [QR{i + 1} {KNOWN.get(b.text, '?')}]"
        crop = crop_with_margin(img, (x0, y0, x1, y1))
        for name, v in variants(crop, sym):
            hits = [r.text for r in decode(v)]
            if b.text in hits:
                record(label, name, "PASS", f"symbol {sym}px -> {v.width}px crop")
            else:
                record(label, name, "FAIL", "not decoded" if not hits else f"decoded {short(hits[0])}")


def render(target: Path, out: Path, w: float, h: float, full: bool = False) -> str | None:
    cmd = ["node", str(RENDER_JS), str(target), str(out), str(round(w)), str(round(h)), str(RENDER_SCALE)]
    if full:
        cmd.append("--full")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired) as e:
        return str(e)
    if r.returncode != 0 or not out.exists():
        return (r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "render failed"
    return None


UNITS = {"in": 96.0, "mm": 96 / 25.4, "cm": 96 / 2.54, "px": 1.0, "pt": 96 / 72}
NAMED = {"letter": (8.5, 11), "legal": (8.5, 14), "a4": (8.27, 11.69), "a5": (5.83, 8.27)}


def page_size(html: Path) -> tuple[float, float] | None:
    """Find an @page size in the page or its local stylesheets; return CSS px."""
    text = html.read_text(errors="ignore")
    for href in re.findall(r'<link[^>]+href="([^"]+\.css)"', text):
        css = (html.parent / href).resolve()
        if css.is_file():
            text += "\n" + css.read_text(errors="ignore")
    for block in re.findall(r"@page[^{]*\{([^}]*)\}", text):
        m = re.search(r"size\s*:\s*([^;]+)", block)
        if not m:
            continue
        val = m.group(1).strip().lower()
        dims = re.findall(r"([\d.]+)\s*(in|mm|cm|px|pt)", val)
        if len(dims) >= 2:
            (a, ua), (b, ub) = dims[:2]
            return float(a) * UNITS[ua], float(b) * UNITS[ub]
        for name, (w, h) in NAMED.items():
            if name in val:
                w, h = (h, w) if "landscape" in val else (w, h)
                return w * 96, h * 96
    return None


def svg_size(svg: Path) -> tuple[float, float]:
    head = svg.read_text(errors="ignore")[:2000]
    w = re.search(r'<svg[^>]*\swidth="([\d.]+)', head)
    h = re.search(r'<svg[^>]*\sheight="([\d.]+)', head)
    if w and h:
        return float(w.group(1)), float(h.group(1))
    vb = re.search(r'viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)', head)
    return (float(vb.group(1)), float(vb.group(2))) if vb else (600.0, 600.0)


def check_pngs() -> None:
    pngs = sorted(ASSETS.glob("*.png"))
    if not pngs:
        record("assets/*.png", "-", "FAIL", "no PNG files found")
    for p in pngs:
        name = f"assets/{p.name}"
        img = Image.open(p)
        if not p.name.startswith("qr-") and not decode(flatten(img)):
            record(name, "-", "SKIP", "not a qr-* asset and contains no QR")
            continue
        exp = expected_for(p.name)
        check_image(name, img, {exp}, exp)


def check_svgs(tmp: Path) -> None:
    for s in sorted(ASSETS.glob("*.svg")):
        name = f"assets/{s.name}"
        if not s.name.startswith("qr-"):
            record(name, "-", "SKIP", "not a qr-* asset")
            continue
        out = tmp / (s.stem + ".svg.png")
        w, h = svg_size(s)
        err = render(s, out, w, h)
        if err:
            record(name, "render", "FAIL", err)
            continue
        exp = expected_for(s.name)
        check_image(name, Image.open(out), {exp}, exp)


def check_pages(tmp: Path) -> None:
    for page in HTML_PAGES:
        p = HERE / page
        if not p.exists():
            record(page, "-", "SKIP", "file does not exist yet")
            continue
        size = page_size(p)
        w, h = size if size else DEFAULT_VIEWPORT
        out = tmp / (p.stem + ".html.png")
        err = render(p, out, w, h, full=size is None)
        if err:
            record(page, "render", "FAIL", err)
            continue
        how = f"@page {w / 96:.2f}x{h / 96:.2f}in" if size else f"{w}x{h} viewport, full page"
        print(f"      rendered {page} ({how}, scale {RENDER_SCALE})")
        check_image(page, Image.open(out), {VCARD, TEL}, VCARD)


def check_vcf() -> None:
    vcfs = sorted(ASSETS.glob("*.vcf")) + sorted(HERE.glob("*.vcf"))
    if not vcfs:
        record("*.vcf", "-", "FAIL", "no .vcf file found")
    for v in vcfs:
        name = str(v.relative_to(HERE))
        raw = v.read_bytes().decode("utf-8", errors="replace")
        unfolded = re.sub(r"\r?\n[ \t]", "", raw)
        lines = [l for l in re.split(r"\r?\n", unfolded) if l]
        props: dict[str, list[str]] = {}
        for line in lines:
            if ":" not in line:
                continue
            key, val = line.split(":", 1)
            props.setdefault(key.split(";")[0].upper(), []).append(val)
        ok_frame = lines[:1] == ["BEGIN:VCARD"] and lines[-1:] == ["END:VCARD"]
        record(name, "BEGIN/END", "PASS" if ok_frame else "FAIL", "" if ok_frame else "missing BEGIN/END:VCARD")
        want = {"FN": CONTACT.get("name", CONTACT["org"]), "ORG": CONTACT["org"], "TEL": CONTACT["phone"], "EMAIL": CONTACT["email"]}
        for key, val in want.items():
            got = props.get(key)
            if not got:
                record(name, key, "FAIL", "missing")
            elif val not in got:
                record(name, key, "FAIL", f"{got[0]!r} != {val!r}")
            else:
                record(name, key, "PASS", got[0])
        same = raw == VCARD
        record(name, "== vcard(CONTACT)", "PASS" if same else "FAIL",
               "" if same else "file differs from generate.py output (re-run generate.py)")


def print_table() -> int:
    tw = max(len(r[0]) for r in results)
    vw = max(len(r[1]) for r in results)
    print()
    print(f"{'TARGET':<{tw}}  {'CHECK':<{vw}}  RESULT  DETAIL")
    print(f"{'-' * tw}  {'-' * vw}  ------  {'-' * 40}")
    for t, v, s, d in results:
        print(f"{t:<{tw}}  {v:<{vw}}  {s:<6}  {d}")
    counts = {s: sum(1 for r in results if r[2] == s) for s in ("PASS", "FAIL", "SKIP")}
    print(f"\n{counts['PASS']} passed, {counts['FAIL']} failed, {counts['SKIP']} skipped")
    print("OVERALL: " + ("FAIL" if counts["FAIL"] else "PASS"))
    return 1 if counts["FAIL"] else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep", type=Path, help="keep rendered screenshots in this directory")
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="qr-verify-"))
    try:
        check_vcf()
        check_pngs()
        if shutil.which("node") and RENDER_JS.exists():
            check_svgs(tmp)
            check_pages(tmp)
        else:
            record("SVG/HTML renders", "-", "FAIL", "node or tools/render.js not available")
    finally:
        if args.keep:
            args.keep.mkdir(parents=True, exist_ok=True)
            for f in tmp.glob("*.png"):
                shutil.copy2(f, args.keep / f.name)
        shutil.rmtree(tmp, ignore_errors=True)
    return print_table()


if __name__ == "__main__":
    sys.exit(main())
