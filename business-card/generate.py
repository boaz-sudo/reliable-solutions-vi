"""Generate the Reliable Solutions VI contact vCard and base QR codes.

Run: pip install segno && python3 business-card/generate.py
"""
from pathlib import Path
import io
import re
import segno

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
ASSETS.mkdir(exist_ok=True)

# Single source of truth for contact details.
CONTACT = {
    "name": "Michael Gooding",
    "given": "Michael",
    "family": "Gooding",
    "role": "Owner",
    "org": "Reliable Solutions VI",
    "title": "Security Cameras & Network Installation",
    "phone": "+13407251919",
    "phone_display": "(340) 725-1919",
    "email": "reliablesolutionsvi@gmail.com",
    "city": "St. Thomas",
    "region": "VI",
    "country": "U.S. Virgin Islands",
    "url": "https://reliablesolutionsvi.com",
}

def vcard(c: dict) -> str:
    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{c['family']};{c['given']};;;",
        f"FN:{c['name']}",
        f"ORG:{c['org']}",
        f"TITLE:{c['role']}",
        f"TEL:{c['phone']}",
        f"EMAIL:{c['email']}",
    ]
    if c["url"]:
        lines.append(f"URL:{c['url']}")
    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"

def sync_inline_qr(qr) -> None:
    """Rewrite the QR inlined in card-back.html and scan-sign.html so they never go stale."""
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=1, border=4, xmldecl=False, svgns=False)
    d = re.search(r' d="([^"]+)"', buf.getvalue().decode()).group(1)
    n = qr.symbol_size(scale=1, border=4)[0]
    subs = {
        "card-back.html": [
            (r'<svg viewBox="0 0 \d+ \d+" role="img" aria-label="QR code', f'<svg viewBox="0 0 {n} {n}" role="img" aria-label="QR code'),
            (r'<rect width="\d+" height="\d+" fill="#FFFFFF"/>', f'<rect width="{n}" height="{n}" fill="#FFFFFF"/>'),
        ],
        "scan-sign.html": [
            (r'viewBox="0 0 \d+ \d+" width="\d+" height="\d+"( shape-rendering="crispEdges" aria-hidden="true" class="segno")',
             f'viewBox="0 0 {n*10} {n*10}" width="{n*10}" height="{n*10}"\\1'),
            (r'M0 0h\d+v\d+h-\d+z', f'M0 0h{n}v{n}h-{n}z'),
        ],
    }
    for name, rules in subs.items():
        f = HERE / name
        if not f.exists():
            continue
        text, hits = re.subn(r'd="M4 4\.5h[^"]+"', f'd="{d}"', f.read_text())
        for pat, rep in rules:
            text, k = re.subn(pat, rep, text)
            hits += k
        f.write_text(text)
        print(f"synced inline QR in {name} ({hits} replacements)")

def main() -> None:
    card = vcard(CONTACT)
    (ASSETS / "reliable-solutions-vi.vcf").write_text(card, newline="")
    qr = segno.make(card, error="m", micro=False)  # payload kept minimal so modules stay large on a ~1" print; segno boosts EC when it fits
    qr.save(ASSETS / "qr-vcard.svg", scale=10, border=4, dark="#0F172A", light="#FFFFFF")
    qr.save(ASSETS / "qr-vcard.png", scale=20, border=4, dark="#0F172A", light="#FFFFFF")
    qr.save(ASSETS / "qr-vcard-mono.svg", scale=10, border=4, dark="#000000", light=None)
    tel = segno.make(f"tel:{CONTACT['phone']}", error="h")
    tel.save(ASSETS / "qr-call.svg", scale=10, border=4, dark="#0F172A", light="#FFFFFF")
    sync_inline_qr(qr)
    print(f"vCard QR: version {qr.version}, error level {qr.error}, {qr.symbol_size(border=0)[0]} modules")

if __name__ == "__main__":
    main()
