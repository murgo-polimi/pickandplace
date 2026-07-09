#!/usr/bin/env python3
"""Generate a VEB.js floor texture with very thin drawn control joints."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageOps


def generate(
    source_path: Path,
    output_path: Path,
    size: int,
    texture_meters: float,
    joint_spacing_meters: float,
    joint_width_meters: float,
    joint_color: tuple[int, int, int],
    include_boundary_joints: bool,
) -> None:
    source = Image.open(source_path).convert("RGB")
    source = ImageOps.fit(source, (size, size), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    source = ImageEnhance.Color(source).enhance(0.06)
    source = ImageEnhance.Contrast(source).enhance(0.28)

    base = Image.new("RGB", (size, size), (166, 166, 158))
    concrete = Image.blend(base, source, 0.28)

    concrete = ImageEnhance.Brightness(concrete).enhance(1.04)

    pixels_per_meter = size / texture_meters
    spacing_px = joint_spacing_meters * pixels_per_meter
    line_width_px = max(1, round(joint_width_meters * pixels_per_meter))

    draw = ImageDraw.Draw(concrete)
    index = 0 if include_boundary_joints else 1
    while True:
        center = round(index * spacing_px)
        if center >= size:
            break
        start = center - line_width_px // 2
        end = start + line_width_px - 1
        draw.rectangle([start, 0, end, size - 1], fill=joint_color)
        draw.rectangle([0, start, size - 1, end], fill=joint_color)
        index += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.suffix.lower() in {".jpg", ".jpeg"}:
        concrete.save(output_path, quality=95, optimize=True, progressive=True)
    else:
        concrete.save(output_path, optimize=True)

    print(f"Wrote {output_path}")
    print(f"Texture size: {size} px")
    print(f"Texture footprint: {texture_meters:g} m")
    print(f"Joint spacing: {joint_spacing_meters:g} m = {spacing_px:.2f} px")
    print(f"Joint width: {joint_width_meters:g} m = {line_width_px} px")


def parse_color(value: str) -> tuple[int, int, int]:
    parts = [int(part) for part in value.split(",")]
    if len(parts) != 3 or any(part < 0 or part > 255 for part in parts):
        raise argparse.ArgumentTypeError("Use R,G,B values from 0 to 255.")
    return tuple(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="concrete_floor.jpg")
    parser.add_argument("--output", default="assets/industrial_concrete_floor_4m_0p2m_drawn_0p5mm_veb.jpg")
    parser.add_argument("--size", type=int, default=8192)
    parser.add_argument("--texture-meters", type=float, default=4)
    parser.add_argument("--joint-spacing-meters", type=float, default=0.2)
    parser.add_argument("--joint-width-meters", type=float, default=0.0005)
    parser.add_argument("--joint-color", type=parse_color, default=(58, 58, 54))
    parser.add_argument(
        "--include-boundary-joints",
        action="store_true",
        help="Draw a single-pixel joint at the texture origin so repeated VEB tiles do not miss seams at repeat boundaries.",
    )
    args = parser.parse_args()

    generate(
        Path(args.source),
        Path(args.output),
        args.size,
        args.texture_meters,
        args.joint_spacing_meters,
        args.joint_width_meters,
        args.joint_color,
        args.include_boundary_joints,
    )


if __name__ == "__main__":
    main()
