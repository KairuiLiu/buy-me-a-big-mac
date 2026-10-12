#!/usr/bin/env python3
"""Render a transparent badge GIF with a damped metal-sign settling motion.

Requirements: Python 3 + Pillow, librsvg's rsvg-convert, fontconfig, and the
Noto Sans CJK SC/TC/HK fonts used by the badges. No website build dependency.
Run from any directory: python3 scripts/render-readme-badges.py
"""

from __future__ import annotations

import argparse
from io import BytesIO
import math
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
LANGUAGES = [
    "badge-zh-cn.svg",
    "badge-zh-tw.svg",
    "badge-yue-cn.svg",
    "badge-yue-hk.svg",
    "badge.svg",
]
SVG = "{http://www.w3.org/2000/svg}"
YELLOW = "#FFC23F"
INK = "#27251F"
TRANSPARENT_INDEX = 255
SCALE = 3
WIDTH, HEIGHT = 960, 260
BADGE_WIDTH, BADGE_HEIGHT = 224 * SCALE, 52 * SCALE
BADGE_X, BADGE_Y = (WIDTH - BADGE_WIDTH) // 2, (HEIGHT - BADGE_HEIGHT) // 2
# Compose each complete badge before rotating its icon, text, outline and shadow.
PANEL_X, PANEL_Y = 52 * SCALE, 4 * SCALE
PANEL_WIDTH, PANEL_HEIGHT = 158 * SCALE, 42 * SCALE
HOLD_MS = 1800
FRAME_MS = 30
FLIP_FRAMES = 20
SETTLE_FRAMES = 30
SETTLE_AMPLITUDE = math.radians(28)
SETTLE_DECAY = 4.4
SETTLE_FREQUENCY = 5 * math.pi


def svg_image(root: ET.Element) -> Image.Image:
    rendered = subprocess.run(
        ["rsvg-convert", "--zoom", str(SCALE)],
        input=ET.tostring(root, encoding="utf-8"),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    return Image.open(BytesIO(rendered.stdout)).convert("RGBA")


def button_shell() -> Image.Image:
    root = ET.parse(ASSETS / "badge.svg").getroot()
    for text in root.findall(f"{SVG}text"):
        root.remove(text)
    return svg_image(root)


def text_panel(filename: str) -> Image.Image:
    root = ET.parse(ASSETS / filename).getroot()
    root.set("width", "224")
    root.set("viewBox", "0 0 224 52")
    for child in list(root):
        if child.tag != f"{SVG}text":
            root.remove(child)
    text = svg_image(root)
    bounds = text.getbbox()
    if bounds is None:
        raise ValueError(f"No rendered text in {filename}")
    if bounds[2] - bounds[0] > PANEL_WIDTH:
        raise ValueError(f"Text overflows the flip panel: {filename}")
    panel = Image.new("RGB", (PANEL_WIDTH, PANEL_HEIGHT), YELLOW)
    # Center without stretching; compensate for Arial's lower visual center.
    crop = text.crop(bounds)
    optical_shift = -round(1.5 * SCALE) if filename == "badge.svg" else 0
    panel.paste(crop, ((PANEL_WIDTH - crop.width) // 2, bounds[1] - PANEL_Y + optical_shift), crop)
    return panel


def shade(image: Image.Image, amount: float) -> Image.Image:
    shaded = Image.blend(image.convert("RGB"), Image.new("RGB", image.size, INK), amount)
    shaded.putalpha(image.getchannel("A"))
    return shaded


def banner(badge: Image.Image) -> Image.Image:
    image = Image.new("RGBA", (WIDTH, HEIGHT))
    image.paste(badge, (BADGE_X, BADGE_Y))
    return image


def project_badge(badge: Image.Image, angle: float) -> Image.Image:
    """Turn every part of the rigid badge together around a fixed horizontal axis."""
    if abs(angle) < 1e-8:
        return banner(badge)
    badge = shade(badge, 0.38 * abs(math.sin(angle)) ** 1.5)
    image = Image.new("RGBA", (WIDTH, HEIGHT))
    if abs(math.cos(angle)) < 0.01:
        edge = badge.resize((BADGE_WIDTH, 2), Image.Resampling.LANCZOS)
        image.paste(edge, (BADGE_X, HEIGHT // 2 - 1))
        return image

    # Perspective projection keeps the next face upright throughout its settling.
    cosine, sine = math.cos(angle), math.sin(angle)
    camera = 1400.0
    source_x, source_y = BADGE_WIDTH / 2, BADGE_HEIGHT / 2
    center_x, center_y = WIDTH / 2, HEIGHT / 2
    denominator = camera * cosine + center_y * sine
    coefficients = (
        camera * cosine / denominator,
        -source_x * sine / denominator,
        source_x - camera * cosine * center_x / denominator,
        0,
        (camera - source_y * sine) / denominator,
        source_y - camera * center_y / denominator,
        0,
        -sine / denominator,
    )
    projected = badge.transform((WIDTH, HEIGHT), Image.Transform.PERSPECTIVE,
                                coefficients, Image.Resampling.BICUBIC)
    image.paste(projected, (0, 0))
    return image


def flip_badge(current: Image.Image, following: Image.Image, progress: float) -> Image.Image:
    """Reveal the next face with enough momentum to continue into its first sway."""
    if progress <= 0:
        return banner(current)
    if progress >= 1:
        return banner(following)
    # Cubic Hermite easing starts at rest and matches the spring's initial speed.
    end_speed = SETTLE_AMPLITUDE * SETTLE_FREQUENCY * FLIP_FRAMES / (math.pi * SETTLE_FRAMES)
    turn = (end_speed - 2) * progress ** 3 + (3 - end_speed) * progress ** 2
    angle = math.pi * turn
    badge = current if turn < 0.5 else following
    return project_badge(badge, angle if turn < 0.5 else angle - math.pi)


def settling_angle(progress: float) -> float:
    if progress <= 0 or progress >= 1:
        return 0.0
    return SETTLE_AMPLITUDE * math.exp(-SETTLE_DECAY * progress) * math.sin(SETTLE_FREQUENCY * progress)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/assets/badge-flip.gif")
    parser.add_argument("--preview-dir", type=Path, help="Also save still frames for visual inspection")
    args = parser.parse_args()
    shell = button_shell()
    badges = []
    for filename in LANGUAGES:
        badge = shell.copy()
        badge.paste(text_panel(filename), (PANEL_X, PANEL_Y))
        badges.append(badge)
    frames: list[Image.Image] = []
    durations: list[int] = []
    rests: list[Image.Image] = []
    for index, badge in enumerate(badges):
        resting = banner(badge)
        rests.append(resting)
        frames.append(resting)
        durations.append(HOLD_MS)
        next_index = (index + 1) % len(badges)
        for step in range(1, FLIP_FRAMES + 1):
            progress = step / FLIP_FRAMES
            frames.append(flip_badge(badge, badges[next_index], progress))
            durations.append(FRAME_MS)
        for step in range(1, SETTLE_FRAMES + 1):
            angle = settling_angle(step / SETTLE_FRAMES)
            frames.append(project_badge(badges[next_index], angle))
            durations.append(FRAME_MS)

    # Use a shared palette with a dedicated transparent index. GIF has binary alpha;
    # threshold edges without a white matte so the badge works on light/dark pages.
    palette_sheet = Image.new("RGB", (WIDTH, HEIGHT * len(frames)), INK)
    masks = [frame.getchannel("A").point(lambda alpha: 255 if alpha >= 128 else 0) for frame in frames]
    for index, frame in enumerate(frames):
        palette_sheet.paste(frame.convert("RGB"), (0, index * HEIGHT), masks[index])
    palette = palette_sheet.quantize(colors=128, method=Image.Quantize.MEDIANCUT)
    colors = palette.getpalette()[:128 * 3]
    palette.putpalette(colors + colors[:3] * 127 + [255, 0, 255])
    indexed = []
    for frame, mask in zip(frames, masks):
        quantized = frame.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE)
        assert TRANSPARENT_INDEX not in {color for _, color in quantized.getcolors()}
        quantized.paste(TRANSPARENT_INDEX, mask=mask.point(lambda alpha: 255 - alpha))
        quantized.info["transparency"] = TRANSPARENT_INDEX
        indexed.append(quantized)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Clear each frame to transparency before drawing the next: a rotating badge
    # exposes previously covered pixels, so retaining the old frame leaves trails.
    indexed[0].save(args.output, save_all=True, append_images=indexed[1:],
                    duration=durations, loop=0, disposal=2, optimize=False,
                    transparency=TRANSPARENT_INDEX, background=TRANSPARENT_INDEX)

    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)
        for index, frame in enumerate(rests):
            frame.save(args.preview_dir / f"language-{index + 1}.png")
        for step in (4, 8, 10, 12, 16):
            frames[step].save(args.preview_dir / f"flip-{step}.png")
        for step in (3, 8, 14, 20, 26, 30):
            frames[FLIP_FRAMES + step].save(args.preview_dir / f"settle-{step}.png")

    with Image.open(args.output) as animation:
        total = 0
        for index in range(animation.n_frames):
            animation.seek(index)
            total += animation.info["duration"]
        assert animation.info.get("loop") == 0
        print(f"{args.output}: {animation.size}, {animation.n_frames} frames, {total} ms, {args.output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
