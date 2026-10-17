#!/usr/bin/env python3
"""Replace the cover image of an epub in place.

    python3 scripts/set_cover.py epubs/Libro.epub nueva-tapa.jpg

The new image is re-encoded to the format of the existing cover so no paths
inside the epub change. Run build_library.py afterwards to refresh covers/.
"""

import io
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_library import NS, find_cover  # noqa: E402

MAX_WIDTH = 1200


def encode(image_path, cover_name):
    img = Image.open(image_path).convert("RGB")
    if img.width > MAX_WIDTH:
        img = img.resize((MAX_WIDTH, round(img.height * MAX_WIDTH / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    if cover_name.lower().endswith(".png"):
        img.save(buf, "PNG", optimize=True)
    else:
        img.save(buf, "JPEG", quality=88, optimize=True, progressive=True)
    return buf.getvalue(), img.size


def fit_svg_cover_pages(text, cover_basename, width, height):
    """SVG cover pages hardcode the old image size in viewBox and <image>."""
    if cover_basename not in text or "<svg" not in text:
        return text
    text = re.sub(r'viewBox="0 0 \d+ \d+"', f'viewBox="0 0 {width} {height}"', text)

    def fix_image(m):
        tag = m.group(0)
        if cover_basename not in tag:
            return tag
        tag = re.sub(r'\bwidth="\d+"', f'width="{width}"', tag)
        return re.sub(r'\bheight="\d+"', f'height="{height}"', tag)

    return re.sub(r"<image\b[^>]*>", fix_image, text)


def main(epub_path, image_path):
    epub_path = Path(epub_path)
    with zipfile.ZipFile(epub_path) as z:
        entries = {i.filename: z.read(i.filename) for i in z.infolist()}
        container = ET.fromstring(entries["META-INF/container.xml"])
        opf_path = container.find(".//c:rootfile", NS).get("full-path")
        opf = ET.fromstring(entries[opf_path])
        cover_path = find_cover(opf, posixpath.dirname(opf_path), set(entries))

    if not cover_path:
        sys.exit(f"no cover found in {epub_path.name}")

    data, (width, height) = encode(image_path, cover_path)
    entries[cover_path] = data
    basename = posixpath.basename(cover_path)
    for name, content in entries.items():
        if re.search(r"\.x?html?$", name, re.I):
            text = content.decode("utf-8")
            updated = fit_svg_cover_pages(text, basename, width, height)
            if updated != text:
                entries[name] = updated.encode("utf-8")

    tmp = epub_path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
        out.writestr(zipfile.ZipInfo("mimetype"), b"application/epub+zip", zipfile.ZIP_STORED)
        for name, content in entries.items():
            if name != "mimetype":
                out.writestr(name, content)
    tmp.replace(epub_path)
    print(f"{epub_path.name}: {cover_path} -> {width}x{height}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
