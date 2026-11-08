"""Branded vCard QR for Reliable Solutions VI.

Navy data modules, rounded blue finder eyes, and the shield logo centred on a
white rounded pad. Error correction is forced to H (30% recovery) and the logo
pad is kept well under that budget. Outputs:

    assets/qr-branded.svg   vector, logo embedded inline
    assets/qr-branded.png   raster (>=1200 px), rendered with cairosvg

After rendering, the PNG (full size and a ~300 px downscale) is decoded with
zxing-cpp and the payload is asserted to equal vcard(CONTACT) exactly.

Run: pip install segno cairosvg zxing-cpp pillow && python3 business-card/qr_branded.py
"""
from __future__ import annotations

import io
import math
import re
import sys
from pathlib import Path

import segno

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate import ASSETS, CONTACT, vcard  # noqa: E402

NAVY = "#0F172A"
BLUE = "#0369A1"
WHITE = "#FFFFFF"
BORDER = 4                 # quiet zone, in modules
PAD_AREA_MAX = 0.20        # logo pad may cover at most this fraction of the symbol
PAD_SIDE_FRACTIONS = (0.36, 0.32, 0.28, 0.24)  # pad side / symbol side, tried in order
#   0.36^2 ~= 13% of the symbol; if a decode check fails the next (smaller) pad is used.
MIN_PNG_PX = 1200


def _logo_inner() -> str:
    """Return the logo's inner markup (everything inside the root <svg>)."""
    src = (ASSETS / "logo.svg").read_text()
    m = re.search(r"<svg[^>]*>(.*)</svg>", src, re.S)
    if not m:
        raise ValueError("assets/logo.svg: could not find <svg> root")
    return "\n".join(line.strip() for line in m.group(1).strip().splitlines())


def _rounded_square(x: float, y: float, size: float, r: float) -> str:
    """Closed path for a rounded square (clockwise)."""
    return (
        f"M{x + r},{y}H{x + size - r}A{r},{r} 0 0 1 {x + size},{y + r}"
        f"V{y + size - r}A{r},{r} 0 0 1 {x + size - r},{y + size}"
        f"H{x + r}A{r},{r} 0 0 1 {x},{y + size - r}"
        f"V{y + r}A{r},{r} 0 0 1 {x + r},{y}Z"
    )


def build_svg(payload: str, pad_fraction: float = PAD_SIDE_FRACTIONS[0]) -> tuple[str, segno.QRCode, dict]:
    qr = segno.make(payload, error="h", boost_error=False, micro=False)
    if qr.error != "H":
        raise RuntimeError(f"expected error level H, got {qr.error}")
    matrix = qr.matrix
    n = len(matrix)
    total = n + 2 * BORDER

    # Finder pattern origins (top-left corner of each 7x7 eye), symbol coords.
    finders = [(0, 0), (n - 7, 0), (0, n - 7)]

    def in_finder(col: int, row: int) -> bool:
        return any(fx <= col < fx + 7 and fy <= row < fy + 7 for fx, fy in finders)

    # Logo pad: centred, whole modules, same parity as n so it sits on the grid.
    pad = int(round(n * pad_fraction))
    if pad % 2 != n % 2:
        pad -= 1
    pad_area = pad * pad / (n * n)
    if pad_area > PAD_AREA_MAX:
        raise RuntimeError(f"logo pad covers {pad_area:.1%} of the symbol (> {PAD_AREA_MAX:.0%})")
    p0 = (n - pad) // 2
    p1 = p0 + pad

    def in_pad(col: int, row: int) -> bool:
        return p0 <= col < p1 and p0 <= row < p1

    # Data modules as one path, merging horizontal runs.
    parts = []
    for row, line in enumerate(matrix):
        col = 0
        while col < n:
            if line[col] & 1 and not in_finder(col, row) and not in_pad(col, row):
                start = col
                while col < n and line[col] & 1 and not in_finder(col, row) and not in_pad(col, row):
                    col += 1
                parts.append(f"M{start + BORDER},{row + BORDER}h{col - start}v1h-{col - start}z")
            else:
                col += 1
    data_path = "".join(parts)

    # Finder eyes: 7x7 rounded ring (even-odd hole) + 3x3 rounded pupil.
    eyes = []
    for fx, fy in finders:
        x, y = fx + BORDER, fy + BORDER
        # Moderate radii: heavier rounding starts to trip weaker detectors (OpenCV).
        ring = _rounded_square(x, y, 7, 1.0) + _rounded_square(x + 1, y + 1, 5, 0.6)
        eyes.append(f'<path fill-rule="evenodd" d="{ring}"/>')
        eyes.append(f'<rect x="{x + 2}" y="{y + 2}" width="3" height="3" rx="0.6"/>')

    # Pad (white, rounded) + logo with an inner margin.
    px = p0 + BORDER
    logo_margin = pad * 0.12
    logo_size = pad - 2 * logo_margin

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {total}" width="{total * 10}" height="{total * 10}" shape-rendering="geometricPrecision">
<title>Reliable Solutions VI - contact QR</title>
<rect width="{total}" height="{total}" fill="{WHITE}"/>
<path fill="{NAVY}" shape-rendering="crispEdges" d="{data_path}"/>
<g fill="{BLUE}">
{chr(10).join(eyes)}
</g>
<rect x="{px}" y="{px}" width="{pad}" height="{pad}" rx="{pad * 0.18:.3f}" fill="{WHITE}"/>
<svg x="{px + logo_margin:.3f}" y="{px + logo_margin:.3f}" width="{logo_size:.3f}" height="{logo_size:.3f}" viewBox="0 0 48 48">
{_logo_inner()}
</svg>
</svg>
"""
    info = {"modules": n, "pad_modules": pad, "pad_area": pad_area, "total_modules": total}
    return svg, qr, info


def render_png(svg: str, total_modules: int) -> bytes:
    import cairosvg

    scale = math.ceil(MIN_PNG_PX / total_modules)  # integer px/module -> crisp edges
    side = scale * total_modules
    return cairosvg.svg2png(bytestring=svg.encode(), output_width=side, output_height=side)


def decode(img) -> list[str]:
    import zxingcpp

    return [r.text for r in zxingcpp.read_barcodes(img, formats=zxingcpp.BarcodeFormat.QRCode)]


def _opencv_ok(img, expected: str) -> bool | None:
    """Secondary, informational check with OpenCV (weaker on styled codes)."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    arr = np.array(img)
    for det in (cv2.QRCodeDetector(), getattr(cv2, "QRCodeDetectorAruco", lambda: None)()):
        if det is not None and det.detectAndDecode(arr)[0] == expected:
            return True
    return False


def verify(png: bytes, expected: str) -> dict:
    """Decode full-size and ~300 px PNG with zxing-cpp; text must equal `expected`."""
    from PIL import Image

    full = Image.open(io.BytesIO(png)).convert("RGB")
    small = full.resize((300, 300), Image.LANCZOS)
    results = {}
    for label, img in (("full", full), ("300px", small)):
        texts = decode(img)
        results[label] = {"size": img.size, "zxing": expected in texts, "texts": texts,
                          "opencv": _opencv_ok(img, expected)}
    return results


def main() -> None:
    payload = vcard(CONTACT)
    for frac in PAD_SIDE_FRACTIONS:
        svg, qr, info = build_svg(payload, frac)
        png = render_png(svg, info["total_modules"])
        results = verify(png, payload)
        if all(r["zxing"] for r in results.values()):
            break
        print(f"  pad {info['pad_modules']} modules failed to decode; trying a smaller pad")
    else:
        raise AssertionError(f"branded QR does not decode: {results!r}")

    svg_path = ASSETS / "qr-branded.svg"
    png_path = ASSETS / "qr-branded.png"
    svg_path.write_text(svg)
    png_path.write_bytes(png)

    print(
        f"Branded QR: version {qr.version}, error {qr.error}, {info['modules']} modules "
        f"(+{BORDER} quiet zone), logo pad {info['pad_modules']}x{info['pad_modules']} "
        f"= {info['pad_area']:.1%} of symbol"
    )
    for label, r in results.items():
        cv = {True: "OK", False: "no", None: "n/a"}[r["opencv"]]
        print(f"  decode {label:>5} {r['size'][0]}x{r['size'][1]}: zxing-cpp OK (exact match), opencv {cv}")
    print(f"Wrote {svg_path.relative_to(ASSETS.parent)} ({len(svg) // 1024} KB) "
          f"and {png_path.relative_to(ASSETS.parent)}")


if __name__ == "__main__":
    main()
