#!/usr/bin/env python3
"""Build a self-contained, vector-only SMIL version of the README badge flip.

Run: python3 scripts/render-animated-badge.py
Generation requires librsvg (rsvg-convert) and Python fontTools. The generated
SVG needs no scripts, styles, fonts, images, or other files at playback time.
The camera and timing match render-readme-badges.py. The generated asset is
committed, so neither the website build nor its visitors need these tools.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import math
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.svgLib.path import parse_path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/assets"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
LANGUAGES = ["badge-zh-cn.svg", "badge-zh-tw.svg", "badge-yue-cn.svg", "badge-yue-hk.svg", "badge.svg"]
HOLD, FLIP, SETTLE = 1.8, .6, .9
STEP, PERIOD = HOLD + FLIP + SETTLE, 5 * (HOLD + FLIP + SETTLE)
CAMERA, CX, CY = 1400 / 3, 112, 26
AMPLITUDE, DECAY, FREQUENCY = math.radians(28), 4.4, 5 * math.pi
END_SPEED = AMPLITUDE * FREQUENCY * FLIP / (math.pi * SETTLE)


def number(value, digits=2):
    rounded = round(value, digits)
    return f"{rounded:.{digits}f}".rstrip("0").rstrip(".") if rounded else "0"


def turn(progress):
    return (END_SPEED - 2) * progress ** 3 + (3 - END_SPEED) * progress ** 2


low, high = 0.0, 1.0
for _ in range(60):
    middle = (low + high) / 2
    if turn(middle) < .5:
        low = middle
    else:
        high = middle
SWAP = HOLD + FLIP * ((low + high) / 2)


def angle_at(time):
    if time <= HOLD or time >= STEP:
        return 0.0
    if time <= HOLD + FLIP:
        progress = turn((time - HOLD) / FLIP)
        return math.pi * (progress if progress < .5 else progress - 1)
    progress = (time - HOLD - FLIP) / SETTLE
    return AMPLITUDE * math.exp(-DECAY * progress) * math.sin(FREQUENCY * progress)


# Linear interpolation between 30 ms samples remains vector animation. Add both
# sides of the edge-on switch so paths never interpolate through the flat face.
TIMES = sorted({0.0, HOLD, STEP, SWAP - .000001, SWAP + .000001,
                *(round(HOLD + i * .03, 8) for i in range(1, 51))})


def project(point, angle):
    x, y = point
    denominator = CAMERA + (y - CY) * math.sin(angle)
    return (CX + CAMERA * (x - CX) / denominator,
            CY + CAMERA * (y - CY) * math.cos(angle) / denominator)


def outline(svg):
    result = subprocess.run(["rsvg-convert", "--format", "svg"],
                            input=ET.tostring(svg), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=True)
    root = ET.fromstring(result.stdout)
    # Cairo's SVG output outlines the text; assert we never ship a font or bitmap.
    forbidden = {"image", "text", "script", "foreignObject", "use"}
    if any(node.tag.split("}")[-1] in forbidden for node in root.iter()):
        raise ValueError("Expected fully outlined paths from rsvg-convert")
    return list(root.findall(f"{{{NS}}}path"))


def geometry(node, dx=0, dy=0):
    pen = RecordingPen()
    parse_path(node.attrib["d"], pen)
    matrix = [1, 0, 0, 1, 0, 0]
    if node.get("transform"):
        match = re.fullmatch(r"matrix\(([^)]+)\)", node.get("transform"))
        if not match:
            raise ValueError(f"Unexpected transform: {node.get('transform')}")
        matrix = [float(v) for v in re.split(r"[,\s]+", match[1].strip())]
    a, b, c, d, e, f = matrix
    return [(command, tuple((a*x + c*y + e + dx, b*x + d*y + f + dy) for x, y in points))
            for command, points in pen.value]


def path_data(commands, angle=0):
    result = []
    names = {"moveTo": "M", "lineTo": "L", "curveTo": "C", "qCurveTo": "Q", "closePath": "Z", "endPath": ""}
    for command, points in commands:
        result.append(names[command] + " ".join(
            f"{number(x)},{number(y)}" for x, y in (project(p, angle) for p in points)))
    return "".join(result)


def animation(parent, attribute, times, values, duration, discrete=False):
    if len(times) != len(values) or any(a >= b for a, b in zip(times, times[1:])):
        raise ValueError("Invalid animation timeline")
    return ET.SubElement(parent, f"{{{NS}}}animate", {
        "attributeName": attribute,
        "dur": f"{number(duration)}s",
        "repeatCount": "indefinite",
        "calcMode": "discrete" if discrete else "linear",
        "keyTimes": ";".join(number(t / duration, 9) for t in times),
        "values": ";".join(values),
    })


def path(parent, source, commands, times, angles, duration):
    attrs = {k: v for k, v in source.attrib.items() if k not in {"transform", "d"}}
    attrs["d"] = path_data(commands)
    node = ET.SubElement(parent, f"{{{NS}}}path", attrs)
    animation(node, "d", times, [path_data(commands, angle) for angle in angles], duration)
    if source.get("stroke-width"):
        width = float(source.get("stroke-width"))
        animation(node, "stroke-width", times,
                  [number(max(.03, width * abs(math.cos(angle)))) for angle in angles], duration)
    return node


def text_timeline(index):
    # Keep only this face's visible motion. Other languages' movement is hidden
    # and does not need to be duplicated in every text path.
    samples = {0.0: 0.0, PERIOD: 0.0}
    for cycle in range(5):
        for time in TIMES:
            visible_face = (cycle + (time > SWAP)) % 5
            if visible_face == index:
                samples[cycle * STEP + time] = angle_at(time)
    times = sorted(samples)
    return times, [samples[time] for time in times]


def build(output):
    root = ET.Element(f"{{{NS}}}svg", {
        "width": "233", "height": "53", "viewBox": "-4.5 -0.5 233 53",
        "fill": "none", "role": "img", "aria-labelledby": "title description",
    })
    ET.SubElement(root, f"{{{NS}}}title", {"id": "title"}).text = "请我吃份巨无霸 · Buy me a Big Mac"
    ET.SubElement(root, f"{{{NS}}}desc", {"id": "description"}).text = (
        "五种语言的赞助按钮轮流翻面并轻轻回摆。全部图形和文字都是矢量，动画每 16.5 秒循环一次。")
    root.append(ET.Comment("Self-contained vector paths + SMIL. No JavaScript, CSS, fonts or raster frames."))

    shell_svg = ET.parse(ASSETS / "badge.svg").getroot()
    for child in list(shell_svg):
        if child.tag == f"{{{NS}}}text":
            shell_svg.remove(child)
    angles = [angle_at(t) for t in TIMES]
    for source in outline(shell_svg):
        path(root, source, geometry(source), TIMES, angles, STEP)

    for index, filename in enumerate(LANGUAGES):
        text_svg = ET.parse(ASSETS / filename).getroot()
        text_svg.set("width", "224")
        text_svg.set("viewBox", "0 0 224 52")
        for child in list(text_svg):
            if child.tag != f"{{{NS}}}text":
                text_svg.remove(child)
        sources = outline(text_svg)
        bounds = BoundsPen(None)
        for source in sources:
            parse_path(source.get("d"), bounds)
        x0, _, x1, _ = bounds.bounds
        dx = 131 - (x0 + x1) / 2
        group = ET.SubElement(root, f"{{{NS}}}g", {"visibility": "visible" if index == 0 else "hidden"})
        switches = [0, *(i * STEP + SWAP for i in range(5)), PERIOD]
        faces = [0, 1, 2, 3, 4, 0, 0]
        animation(group, "visibility", switches,
                  ["visible" if face == index else "hidden" for face in faces], PERIOD, discrete=True)
        times, text_angles = text_timeline(index)
        for source in sources:
            path(group, source, geometry(source, dx, -1.5 if index == 4 else 0), times, text_angles, PERIOD)

    # Darkening belongs to the entire sign, including the burger and text.
    shade_svg = deepcopy(shell_svg)
    for child in list(shade_svg):
        shade_svg.remove(child)
    ET.SubElement(shade_svg, f"{{{NS}}}rect", {"x": "0", "y": "0", "width": "224", "height": "49", "rx": "11", "fill": "#27251F"})
    shade_source = outline(shade_svg)[0]
    shade_source.set("opacity", "0")
    shade_node = path(root, shade_source, geometry(shade_source), TIMES, angles, STEP)
    animation(shade_node, "opacity", TIMES,
              [number(.38 * abs(math.sin(a)) ** 1.5, 4) for a in angles], STEP)

    output.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    print(f"Wrote {output}: {output.stat().st_size:,} bytes, 233 × 53, {PERIOD:g}s loop")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ASSETS / "badge-carousel.svg")
    build(parser.parse_args().output)
