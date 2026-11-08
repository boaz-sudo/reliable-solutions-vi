"""Generate the Reliable Solutions VI contact vCard and base QR codes.

Run: pip install segno && python3 business-card/generate.py
"""
from pathlib import Path
import segno

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
ASSETS.mkdir(exist_ok=True)

# Single source of truth for contact details.
CONTACT = {
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
        f"FN:{c['org']}",
        f"ORG:{c['org']}",
        f"N:{c['org']};;;;",
        f"TEL:{c['phone']}",
        f"EMAIL:{c['email']}",
    ]
    if c["url"]:
        lines.append(f"URL:{c['url']}")
    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"

def main() -> None:
    card = vcard(CONTACT)
    (ASSETS / "reliable-solutions-vi.vcf").write_text(card, newline="")
    qr = segno.make(card, error="m", micro=False)  # payload kept minimal so modules stay large on a ~1" print; segno boosts EC when it fits
    qr.save(ASSETS / "qr-vcard.svg", scale=10, border=4, dark="#0F172A", light="#FFFFFF")
    qr.save(ASSETS / "qr-vcard.png", scale=20, border=4, dark="#0F172A", light="#FFFFFF")
    qr.save(ASSETS / "qr-vcard-mono.svg", scale=10, border=4, dark="#000000", light=None)
    tel = segno.make(f"tel:{CONTACT['phone']}", error="h")
    tel.save(ASSETS / "qr-call.svg", scale=10, border=4, dark="#0F172A", light="#FFFFFF")
    print(f"vCard QR: version {qr.version}, error level {qr.error}, {qr.symbol_size(border=0)[0]} modules")

if __name__ == "__main__":
    main()
