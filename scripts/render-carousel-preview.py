#!/usr/bin/env python3
"""Make an opaque animated link card from the existing five-language badge GIF.

Requirements: Python 3 + Pillow. This is an offline asset-generation tool, not a
website build dependency. Run from any directory:
    python3 scripts/render-carousel-preview.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/assets/badge-flip.gif"
DESTINATION = ROOT / "public/assets/card-carousel.gif"
WIDTH, HEIGHT = 1200, 630
BACKGROUND = "#fffcf5"
COLORS = 64
# The source renders each 224 × 52 badge at 3×; static link cards use 3.8×.
SCALE = 3.8 / 3


def source_metadata(source: Path) -> tuple[tuple[int, int, int, int], list[int]]:
    bounds = None
    durations = []
    with Image.open(source) as animation:
        for index in range(animation.n_frames):
            animation.seek(index)
            durations.append(animation.info["duration"])
            frame_bounds = animation.convert("RGBA").getbbox()
            if frame_bounds:
                bounds = frame_bounds if bounds is None else (
                    min(bounds[0], frame_bounds[0]), min(bounds[1], frame_bounds[1]),
                    max(bounds[2], frame_bounds[2]), max(bounds[3], frame_bounds[3]),
                )
    if bounds is None:
        raise ValueError("Source animation has no visible pixels")
    return bounds, durations


def resized_frame(animation: Image.Image, bounds: tuple[int, int, int, int]) -> Image.Image:
    crop = animation.convert("RGBA").crop(bounds)
    crop = crop.resize((round(crop.width * SCALE), round(crop.height * SCALE)),
                       Image.Resampling.LANCZOS)
    opaque = Image.new("RGB", crop.size, BACKGROUND)
    opaque.paste(crop, mask=crop.getchannel("A"))
    return opaque


def shared_palette(source: Path, bounds: tuple[int, int, int, int]) -> Image.Image:
    """Use one palette for all frames so stationary colours do not flicker."""
    with Image.open(source) as animation:
        sample_size = (round((bounds[2] - bounds[0]) * SCALE / 2),
                       round((bounds[3] - bounds[1]) * SCALE / 2))
        sheet = Image.new("RGB", (sample_size[0], sample_size[1] * animation.n_frames), BACKGROUND)
        for index in range(animation.n_frames):
            animation.seek(index)
            sample = resized_frame(animation, bounds).resize(sample_size, Image.Resampling.LANCZOS)
            sheet.paste(sample, (0, sample_size[1] * index))
    quantized = sheet.quantize(colors=COLORS - 1, method=Image.Quantize.MEDIANCUT)
    palette = Image.new("P", (1, 1))
    # Reserve an exact, opaque cream background rather than quantizing its colour.
    palette.putpalette(list(ImageColor.getrgb(BACKGROUND)) + quantized.getpalette()[:(COLORS - 1) * 3])
    return palette


def render(source: Path, destination: Path, contact_sheet: Path | None) -> None:
    bounds, durations = source_metadata(source)
    palette = shared_palette(source, bounds)
    frames = []
    with Image.open(source) as animation:
        position = (round(WIDTH / 2 + (bounds[0] - animation.width / 2) * SCALE),
                    round(HEIGHT / 2 + (bounds[1] - animation.height / 2) * SCALE))
        for index in range(animation.n_frames):
            animation.seek(index)
            pixels = resized_frame(animation, bounds).quantize(palette=palette, dither=Image.Dither.NONE)
            frame = Image.new("P", (WIDTH, HEIGHT), 0)
            frame.putpalette(palette.getpalette())
            frame.paste(pixels, position)
            frames.append(frame)

    destination.parent.mkdir(parents=True, exist_ok=True)
    # Each composed frame is fully opaque. Disposal 1 lets GIF store changed
    # rectangles, including newly exposed cream pixels, without leaving trails.
    # Disabling palette optimization keeps the shared palette and introduces no
    # transparent pixels; crop/delta encoding still reduces the file size.
    frames[0].save(destination, save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, disposal=1, optimize=False, background=0)

    # Compare every decoded frame with its fully composed source frame. This
    # checks that delta rectangles clear old button positions during each flip.
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
        assert elapsed == sum(durations)
        assert expected_index == len(frames)
        print(f"{destination}: {WIDTH}×{HEIGHT}, {animation.n_frames} frames, "
              f"{elapsed} ms, infinite loop, {destination.stat().st_size:,} bytes; "
              "all decoded frames match; opaque background")

    if contact_sheet:
        # Resting language faces plus representative flip/settling frames.
        indices = [index for index, duration in enumerate(durations) if duration >= 1000]
        indices += [8, 10, 12, 20, 28]
        tile_width, tile_height = 400, 238
        sheet = Image.new("RGB", (tile_width * 2, tile_height * 5), BACKGROUND)
        draw = ImageDraw.Draw(sheet)
        for tile, index in enumerate(indices):
            x, y = (tile % 2) * tile_width, (tile // 2) * tile_height
            sheet.paste(frames[index].convert("RGB").resize((400, 210), Image.Resampling.LANCZOS), (x, y))
            draw.text((x + 12, y + 212), f"Frame {index} / {sum(durations[:index]) / 1000:.2f}s", fill="#25251e")
        contact_sheet.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(contact_sheet)
        print(f"Contact sheet: {contact_sheet}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=DESTINATION)
    parser.add_argument("--contact-sheet", type=Path)
    args = parser.parse_args()
    render(args.source, args.output, args.contact_sheet)


if __name__ == "__main__":
    main()
