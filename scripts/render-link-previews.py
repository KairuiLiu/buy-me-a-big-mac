#!/usr/bin/env python3
"""Render the PNG cards that iMessage, Telegram and other crawlers show for a link.

Crawlers do not run JavaScript and ignore SVG, so every card is a flat PNG
committed next to the badges. One card per badge language plus one site card.

Requirements: Python 3 + Pillow, librsvg's rsvg-convert, fontconfig, and the
Noto Sans CJK SC/TC/HK fonts used by the badges. No website build dependency.
Run from any directory: python3 scripts/render-link-previews.py
"""

from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
BADGES = {
    "en": "badge.svg",
    "zh-cn": "badge-zh-cn.svg",
    "zh-tw": "badge-zh-tw.svg",
    "yue-cn": "badge-yue-cn.svg",
    "yue-hk": "badge-yue-hk.svg",
}
SVG = "{http://www.w3.org/2000/svg}"
# Open Graph's documented card size; messengers crop from the centre.
WIDTH, HEIGHT = 1200, 630
BACKGROUND, INK, YELLOW, RED, MUTED = "#fffcf5", "#25251e", "#ffbc0d", "#c92e20", "#736f61"
SANS = "Helvetica Neue, Helvetica, Arial, Noto Sans CJK SC, PingFang SC, sans-serif"
BADGE_SCALE = 3.8


def card(*children: ET.Element) -> ET.Element:
    """A plain off-white canvas, matching the original card's inner panel."""
    root = ET.Element(f"{SVG}svg", {
        "xmlns": "http://www.w3.org/2000/svg",
        "width": str(WIDTH), "height": str(HEIGHT), "viewBox": f"0 0 {WIDTH} {HEIGHT}",
    })
    ET.SubElement(root, f"{SVG}rect", {
        "width": str(WIDTH), "height": str(HEIGHT), "fill": BACKGROUND,
    })
    root.extend(children)
    return root


def text(content: str, x: float, y: float, size: float, weight: str = "700",
         fill: str = INK, tracking: float = 0, anchor: str = "middle") -> ET.Element:
    element = ET.Element(f"{SVG}text", {
        "x": f"{x:.1f}", "y": f"{y:.1f}", "fill": fill, "font-family": SANS,
        "font-size": f"{size:g}", "font-weight": weight, "text-anchor": anchor,
        "letter-spacing": f"{tracking:g}",
    })
    element.text = content
    return element


def share_card(filename: str) -> ET.Element:
    """Blow up the README badge, the one image supporters already recognise."""
    badge = ET.parse(ASSETS / filename).getroot()
    scaled = ET.Element(f"{SVG}g")
    for child in badge:
        if child.tag not in (f"{SVG}title", f"{SVG}desc"):
            scaled.append(child)
    width = float(badge.get("width")) * BADGE_SCALE
    height = float(badge.get("height")) * BADGE_SCALE
    left = (WIDTH - width) / 2
    top = (HEIGHT - height) / 2
    scaled.set("transform", f"translate({left:.1f} {top:.1f}) scale({BADGE_SCALE})")
    return card(scaled)


def site_card() -> ET.Element:
    """Match the header brand: burger mark in a yellow tile beside the wordmark."""
    mark = ET.parse(ASSETS / "mark.svg").getroot()
    tile, glyph = 196, 148
    left = 232
    middle = HEIGHT / 2
    group = ET.Element(f"{SVG}g")
    ET.SubElement(group, f"{SVG}rect", {
        "x": str(left), "y": f"{middle - tile / 2 - 18:.1f}",
        "width": str(tile), "height": str(tile), "fill": YELLOW,
    })
    paths = ET.SubElement(group, f"{SVG}g", {
        "transform": f"translate({left + (tile - glyph) / 2:.1f} "
                     f"{middle - tile / 2 - 18 + (tile - glyph) / 2:.1f}) scale({glyph / 256:.4f})",
        "fill": INK,
    })
    for path in mark.findall(f"{SVG}path"):
        paths.append(path)
    wordmark = left + tile + 44
    group.append(text("BUY ME A", wordmark, middle - 62, 46, "800", tracking=-1.4, anchor="start"))
    dot = text("BIG MAC", wordmark, middle + 20, 92, "900", tracking=-2.8, anchor="start")
    ET.SubElement(dot, f"{SVG}tspan", {"fill": RED, "font-size": "112"}).text = "."
    group.append(dot)
    group.append(text("给喜欢的开源项目加个餐", wordmark, middle + 76, 32, "700", MUTED, 1.2, "start"))
    return card(group)


def render(root: ET.Element, destination: Path) -> None:
    rendered = subprocess.run(
        ["rsvg-convert", "--width", str(WIDTH), "--height", str(HEIGHT)],
        input=ET.tostring(root, encoding="utf-8"),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    image = Image.open(BytesIO(rendered.stdout))
    if image.size != (WIDTH, HEIGHT):
        raise ValueError(f"{destination.name}: expected {WIDTH}x{HEIGHT}, got {image.size[0]}x{image.size[1]}")
    # Flatten the alpha channel: a transparent card turns black in iMessage.
    opaque = Image.new("RGB", image.size, BACKGROUND)
    opaque.paste(image, mask=image.convert("RGBA").getchannel("A"))
    opaque.save(destination, optimize=True)
    print(f"{destination.name}: {WIDTH}x{HEIGHT}, {destination.stat().st_size:,} bytes")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ASSETS)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    render(site_card(), args.output_dir / "card-home.png")
    for language, filename in BADGES.items():
        render(share_card(filename), args.output_dir / f"card-{language}.png")


if __name__ == "__main__":
    main()
