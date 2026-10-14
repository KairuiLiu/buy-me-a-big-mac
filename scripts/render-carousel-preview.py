#!/usr/bin/env python3
"""Animate the existing PNG link cards without changing their badge geometry.

Requirements: Python 3 + Pillow. This is an offline asset-generation tool, not a
website build dependency. Run from any directory:
    python3 scripts/render-carousel-preview.py
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets"
DESTINATION = SOURCE / "card-carousel-aligned.gif"
LANGUAGES = ["zh-cn", "zh-tw", "yue-cn", "yue-hk", "en"]
WIDTH, HEIGHT = 1200, 630
BACKGROUND, INK = "#fffcf5", "#27251f"
COLORS = 64
HOLD_MS, FRAME_MS = 1800, 30
FLIP_FRAMES, SETTLE_FRAMES = 20, 30
SETTLE_AMPLITUDE = math.radians(28)
SETTLE_DECAY, SETTLE_FREQUENCY = 4.4, 5 * math.pi
# Preserve the perspective of the README animation at the link cards' 3.8× scale.
CAMERA = 1400 * 3.8 / 3


def content_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    bounds = ImageChops.difference(image.convert("RGB"),
                                  Image.new("RGB", image.size, BACKGROUND)).getbbox()
    if bounds is None:
        raise ValueError("Card has no visible badge")
    return bounds


def load_badges(source: Path) -> list[tuple[Image.Image, tuple[int, int]]]:
    badges = []
    for language in LANGUAGES:
        with Image.open(source / f"card-{language}.png") as image:
            if image.size != (WIDTH, HEIGHT):
                raise ValueError(f"card-{language}.png must be {WIDTH}×{HEIGHT}")
            card = image.convert("RGB")
        bounds = content_bounds(card)
        badge = card.crop(bounds).convert("RGBA")
        # Keep the PNG's antialiased edge pixels; only the exact cream canvas is
        # transparent. Neither the lettering nor the language-specific shell is
        # resized or redrawn.
        difference = ImageChops.difference(badge.convert("RGB"),
                                          Image.new("RGB", badge.size, BACKGROUND))
        channels = difference.split()
        mask = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
        badge.putalpha(mask.point(lambda value: 255 if value else 0))
        badges.append((badge, bounds[:2]))
    return badges


def project_badge(badge: Image.Image, position: tuple[int, int], angle: float
                  ) -> tuple[Image.Image, tuple[int, int]]:
    """Rotate each native-width badge around the original card's centre."""
    if abs(angle) < 1e-8:
        return badge, position
    shade = 0.38 * abs(math.sin(angle)) ** 1.5
    shaded = Image.blend(badge.convert("RGB"), Image.new("RGB", badge.size, INK), shade)
    shaded.putalpha(badge.getchannel("A"))
    if abs(math.cos(angle)) < 0.01:
        return shaded.resize((badge.width, 2), Image.Resampling.LANCZOS), (position[0], HEIGHT // 2 - 1)

    cosine, sine = math.cos(angle), math.sin(angle)
    center_x, center_y = WIDTH / 2, HEIGHT / 2
    # The PNG's visible bounds exclude the SVG's few empty bottom pixels. The
    # pivot therefore uses the original card centre, not the cropped midpoint.
    source_x, source_y = center_x - position[0], center_y - position[1]
    denominator = CAMERA * cosine + center_y * sine
    coefficients = (
        CAMERA * cosine / denominator,
        -source_x * sine / denominator,
        source_x - CAMERA * cosine * center_x / denominator,
        0,
        (CAMERA - source_y * sine) / denominator,
        source_y - CAMERA * center_y / denominator,
        0,
        -sine / denominator,
    )
    projected = shaded.transform((WIDTH, HEIGHT), Image.Transform.PERSPECTIVE,
                                 coefficients, Image.Resampling.BICUBIC)
    bounds = projected.getbbox()
    if bounds is None:
        raise ValueError("Projected badge has no visible pixels")
    return projected.crop(bounds), bounds[:2]


def animation_frames(badges: list[tuple[Image.Image, tuple[int, int]]]
                     ) -> tuple[list[tuple[Image.Image, tuple[int, int]]], list[int]]:
    frames, durations = [], []
    end_speed = SETTLE_AMPLITUDE * SETTLE_FREQUENCY * FLIP_FRAMES / (math.pi * SETTLE_FRAMES)
    for index, current in enumerate(badges):
        following = badges[(index + 1) % len(badges)]
        frames.append(current)
        durations.append(HOLD_MS)
        for step in range(1, FLIP_FRAMES + 1):
            progress = step / FLIP_FRAMES
            turn = (end_speed - 2) * progress ** 3 + (3 - end_speed) * progress ** 2
            angle = math.pi * turn
            face = current if turn < 0.5 else following
            frames.append(project_badge(*face, angle if turn < 0.5 else angle - math.pi))
            durations.append(FRAME_MS)
        for step in range(1, SETTLE_FRAMES + 1):
            progress = step / SETTLE_FRAMES
            angle = (SETTLE_AMPLITUDE * math.exp(-SETTLE_DECAY * progress)
                     * math.sin(SETTLE_FREQUENCY * progress)) if progress < 1 else 0
            frames.append(project_badge(*following, angle))
            durations.append(FRAME_MS)
    return frames, durations


def opaque_crop(badge: Image.Image) -> Image.Image:
    opaque = Image.new("RGB", badge.size, BACKGROUND)
    opaque.paste(badge, mask=badge.getchannel("A"))
    return opaque


def shared_palette(frames: list[tuple[Image.Image, tuple[int, int]]]) -> Image.Image:
    """Use one palette so stationary colours do not flicker between frames."""
    sample_width, sample_height = 450, 110
    sheet = Image.new("RGB", (sample_width, sample_height * len(frames)), BACKGROUND)
    for index, (badge, _) in enumerate(frames):
        sample = opaque_crop(badge)
        sample.thumbnail((sample_width, sample_height), Image.Resampling.LANCZOS)
        sheet.paste(sample, (0, index * sample_height))
    quantized = sheet.quantize(colors=COLORS - 1, method=Image.Quantize.MEDIANCUT)
    palette = Image.new("P", (1, 1))
    # Reserve an exact, opaque cream background instead of quantizing its colour.
    palette.putpalette(list(ImageColor.getrgb(BACKGROUND)) + quantized.getpalette()[:(COLORS - 1) * 3])
    return palette


def render(source: Path, destination: Path, contact_sheet: Path | None) -> None:
    badges = load_badges(source)
    projected, durations = animation_frames(badges)
    palette = shared_palette(projected)
    frames = []
    for badge, position in projected:
        pixels = opaque_crop(badge).quantize(palette=palette, dither=Image.Dither.NONE)
        frame = Image.new("P", (WIDTH, HEIGHT), 0)
        frame.putpalette(palette.getpalette())
        frame.paste(pixels, position)
        frames.append(frame)

    # All five resting faces must occupy the exact same bounds as their PNGs.
    resting_indices = [index for index, duration in enumerate(durations) if duration == HOLD_MS]
    for language, index, (badge, position) in zip(LANGUAGES, resting_indices, badges):
        expected = (*position, position[0] + badge.width, position[1] + badge.height)
        assert content_bounds(frames[index]) == expected, (language, expected, content_bounds(frames[index]))
        print(f"{language}: resting bounds {expected}, matching static PNG")

    destination.parent.mkdir(parents=True, exist_ok=True)
    # Fully opaque delta frames clear previously covered areas without trails.
    frames[0].save(destination, save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, disposal=1, optimize=False, background=0)

    elapsed, expected_index = 0, 0
    with Image.open(destination) as animation:
        assert animation.size == (WIDTH, HEIGHT)
        assert animation.info.get("loop") == 0
        assert "transparency" not in animation.info
        for index in range(animation.n_frames):
            animation.seek(index)
            decoded = animation.convert("RGB")
            duration = animation.info["duration"]
            remaining = duration
            while remaining:
                assert ImageChops.difference(decoded, frames[expected_index].convert("RGB")).getbbox() is None
                remaining -= durations[expected_index]
                expected_index += 1
                assert remaining >= 0
            assert decoded.getpixel((0, 0)) == ImageColor.getrgb(BACKGROUND)
            elapsed += duration
        assert elapsed == sum(durations) == 16500
        assert expected_index == len(frames)
        assert destination.stat().st_size < 5_000_000
        print(f"{destination}: {WIDTH}×{HEIGHT}, {animation.n_frames} frames, "
              f"{elapsed} ms, infinite loop, {destination.stat().st_size:,} bytes; "
              "all decoded frames match; opaque background")

    if contact_sheet:
        # Static PNG beside its matching animated face, plus five moving frames.
        sheet = Image.new("RGB", (1200, 5 * 240), BACKGROUND)
        draw = ImageDraw.Draw(sheet)
        for row, (language, resting, moving) in enumerate(zip(LANGUAGES, resting_indices, [8, 10, 12, 20, 28])):
            with Image.open(source / f"card-{language}.png") as image:
                images = [image.convert("RGB"), frames[resting].convert("RGB"), frames[moving].convert("RGB")]
            labels = [f"Static {language}", f"GIF {language}", f"Motion frame {moving}"]
            for column, (image, label) in enumerate(zip(images, labels)):
                x, y = column * 400, row * 240
                sheet.paste(image.resize((400, 210), Image.Resampling.LANCZOS), (x, y))
                draw.text((x + 12, y + 214), label, fill="#25251e")
        contact_sheet.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(contact_sheet)
        print(f"Contact sheet: {contact_sheet}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE, help="Directory containing the five static PNG cards")
    parser.add_argument("--output", type=Path, default=DESTINATION)
    parser.add_argument("--contact-sheet", type=Path)
    args = parser.parse_args()
    render(args.source, args.output, args.contact_sheet)


if __name__ == "__main__":
    main()
