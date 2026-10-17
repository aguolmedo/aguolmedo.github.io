#!/usr/bin/env python3
"""Generate books.json and cover thumbnails from the epubs in epubs/.

Run from anywhere after adding or removing books:
    python3 scripts/build_library.py
"""

import html
import io
import json
import posixpath
import re
import unicodedata
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EPUBS = ROOT / "epubs"
COVERS = ROOT / "covers"
COVER_WIDTH = 400

NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def strip_html(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def find_cover(opf, opf_dir, names):
    manifest = opf.find("opf:manifest", NS)
    items = manifest.findall("opf:item", NS) if manifest is not None else []
    is_image = lambda i: i.get("media-type", "").startswith("image/")

    candidates = [i for i in items if "cover-image" in i.get("properties", "").split()]
    meta = opf.find("opf:metadata/opf:meta[@name='cover']", NS)
    if meta is not None:
        candidates += [i for i in items if i.get("id") == meta.get("content")]
    candidates += [
        i for i in items
        if is_image(i) and "cover" in (i.get("id", "") + i.get("href", "")).lower()
    ]
    for item in candidates:
        if not is_image(item):
            continue
        path = posixpath.normpath(posixpath.join(opf_dir, unquote(item.get("href"))))
        if path in names:
            return path
    return None


def read_book(epub_path):
    with zipfile.ZipFile(epub_path) as z:
        names = set(z.namelist())
        container = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = container.find(".//c:rootfile", NS).get("full-path")
        opf = ET.fromstring(z.read(opf_path))
        md = opf.find("opf:metadata", NS)
        dc = lambda tag: [e.text.strip() for e in md.findall(f"dc:{tag}", NS) if e.text]

        book = {
            "file": f"epubs/{epub_path.name}",
            "title": (dc("title") or [epub_path.stem])[0],
            "authors": dc("creator"),
            "language": (dc("language") or [""])[0],
            "publisher": (dc("publisher") or [""])[0],
            "description": strip_html((dc("description") or [""])[0]),
            "cover": None,
        }

        cover_path = find_cover(opf, posixpath.dirname(opf_path), names)
        if cover_path:
            img = Image.open(io.BytesIO(z.read(cover_path))).convert("RGB")
            if img.width > COVER_WIDTH:
                img = img.resize((COVER_WIDTH, round(img.height * COVER_WIDTH / img.width)), Image.LANCZOS)
            out = COVERS / f"{slugify(epub_path.stem)}.jpg"
            img.save(out, "JPEG", quality=82, optimize=True, progressive=True)
            book["cover"] = f"covers/{out.name}"
        return book


def main():
    COVERS.mkdir(exist_ok=True)
    for old in COVERS.glob("*.jpg"):
        old.unlink()
    books = [read_book(p) for p in sorted(EPUBS.glob("*.epub"))]
    books.sort(key=lambda b: unicodedata.normalize("NFKD", b["title"]).lower())
    (ROOT / "books.json").write_text(json.dumps(books, ensure_ascii=False, indent=2) + "\n")
    missing = [b["title"] for b in books if not b["cover"]]
    print(f"{len(books)} books, {len(books) - len(missing)} covers")
    for title in missing:
        print(f"  no cover: {title}")


if __name__ == "__main__":
    main()
