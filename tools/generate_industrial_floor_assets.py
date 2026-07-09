#!/usr/bin/env python3
"""Generate reusable industrial concrete floor textures from concrete_floor.jpg."""

from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

from PIL import Image

DEFAULT_SEAM_WIDTH_METERS = 0.005
DEFAULT_SEAM_DARKENING = 26.0
DEFAULT_SEAM_DEPTH = 0.042


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def smooth_step(edge0: float, edge1: float, value: float) -> float:
    t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def hash_noise(x: float, y: float, seed: float) -> float:
    value = math.sin((x + seed * 19.19) * 127.1 + (y - seed * 7.73) * 311.7) * 43758.5453123
    return value - math.floor(value)


def value_noise(x: float, y: float, seed: float) -> float:
    xi = math.floor(x)
    yi = math.floor(y)
    tx = x - xi
    ty = y - yi
    sx = smooth_step(0, 1, tx)
    sy = smooth_step(0, 1, ty)
    a = hash_noise(xi, yi, seed)
    b = hash_noise(xi + 1, yi, seed)
    c = hash_noise(xi, yi + 1, seed)
    d = hash_noise(xi + 1, yi + 1, seed)
    top = a + (b - a) * sx
    bottom = c + (d - c) * sx
    return top + (bottom - top) * sy


def fbm_noise(x: float, y: float, seed: float, octaves: int) -> float:
    amplitude = 0.5
    frequency = 1.0
    total = 0.0
    norm = 0.0
    for octave in range(octaves):
        total += value_noise(x * frequency, y * frequency, seed + octave * 17.31) * amplitude
        norm += amplitude
        amplitude *= 0.5
        frequency *= 2.03
    return total / norm if norm else 0.0


def wrap01(value: float) -> float:
    return value - math.floor(value)


def create_slab_variants(slab_count: int) -> list[dict[str, float | bool | int]]:
    variants = []
    for y in range(slab_count):
        for x in range(slab_count):
            rng = random.Random(9109 + x * 47569 + y * 91757)
            variants.append(
                {
                    "offset_u": rng.random(),
                    "offset_v": rng.random(),
                    "rotation": math.floor(rng.random() * 4),
                    "mirror": rng.random() > 0.5,
                    "sample_scale": 0.72 + rng.random() * 0.5,
                    "tone_offset": -1.8 + rng.random() * 3.6,
                    "height_bias": -0.006 + rng.random() * 0.012,
                    "wear_seed_a": 1000 + rng.random() * 9000,
                    "wear_seed_b": 1000 + rng.random() * 9000,
                    "wear_angle_a": rng.random() * math.pi,
                    "wear_angle_b": rng.random() * math.pi,
                }
            )
    return variants


def transform_slab_uv(u: float, v: float, slab: dict[str, float | bool | int]) -> tuple[float, float]:
    tu = 1 - u if slab["mirror"] else u
    tv = v
    rotation = int(slab["rotation"])
    if rotation == 1:
        tu, tv = tv, 1 - tu
    elif rotation == 2:
        tu, tv = 1 - tu, 1 - tv
    elif rotation == 3:
        tu, tv = 1 - tv, tu
    return tu * float(slab["sample_scale"]) + float(slab["offset_u"]), tv * float(slab["sample_scale"]) + float(slab["offset_v"])


def saw_cut_line_mask(
    pixel: int,
    slab_pixel_size: float,
    slab_count: int,
    slab_size_m: float,
    seam_width_m: float,
    include_border_seams: bool,
    min_seam_pixels: float,
    seam_feather_pixels: float,
) -> float:
    coordinate = pixel + 0.5
    boundary = round(coordinate / slab_pixel_size)
    if include_border_seams:
        if boundary < 0 or boundary > slab_count:
            return 0.0
    elif boundary <= 0 or boundary >= slab_count:
        return 0.0
    boundary_pixel = boundary * slab_pixel_size
    seam_width_pixels = max(min_seam_pixels, seam_width_m * (slab_pixel_size / slab_size_m))
    half_width = seam_width_pixels * 0.5
    feather = half_width + seam_feather_pixels
    return 1.0 - smooth_step(half_width, feather, abs(coordinate - boundary_pixel))


def saw_cut_mask(
    x: int,
    y: int,
    slab_pixel_size: float,
    slab_count: int,
    slab_size_m: float,
    seam_width_m: float,
    include_border_seams: bool,
    min_seam_pixels: float,
    seam_feather_pixels: float,
) -> float:
    return max(
        saw_cut_line_mask(
            x,
            slab_pixel_size,
            slab_count,
            slab_size_m,
            seam_width_m,
            include_border_seams,
            min_seam_pixels,
            seam_feather_pixels,
        ),
        saw_cut_line_mask(
            y,
            slab_pixel_size,
            slab_count,
            slab_size_m,
            seam_width_m,
            include_border_seams,
            min_seam_pixels,
            seam_feather_pixels,
        ),
    )


def oriented_wear(u: float, v: float, angle: float, seed: float, width: float, strength: float) -> float:
    centered_u = u - 0.5
    centered_v = v - 0.5
    along = centered_u * math.cos(angle) + centered_v * math.sin(angle)
    across = -centered_u * math.sin(angle) + centered_v * math.cos(angle)
    wandering = (fbm_noise(along * 5 + seed, across * 2 - seed, 859, 3) - 0.5) * 0.08
    line = 1 - smooth_step(width, width * 2.8, abs(across + wandering))
    broken = smooth_step(0.34, 0.78, fbm_noise(along * 6 + seed, across * 4 + seed, 863, 3))
    return line * broken * strength


def slab_wear(local_u: float, local_v: float, slab: dict[str, float | bool | int], slab_x: int, slab_y: int) -> tuple[float, float]:
    world_u = slab_x + local_u
    world_v = slab_y + local_v
    seed_a = float(slab["wear_seed_a"])
    seed_b = float(slab["wear_seed_b"])
    broad = fbm_noise(world_u * 0.72 + seed_a, world_v * 0.72 - seed_a, 811, 5) - 0.5
    soft_cloud = fbm_noise(world_u * 1.35 - seed_b, world_v * 1.1 + seed_b, 823, 4) - 0.5
    fine_wear = fbm_noise(world_u * 9.5 + seed_b, world_v * 8.5 - seed_a, 839, 3) - 0.5
    line_a = oriented_wear(local_u, local_v, float(slab["wear_angle_a"]), seed_a, 0.018, 0.55)
    line_b = oriented_wear(local_u, local_v, float(slab["wear_angle_b"]), seed_b, 0.012, 0.32)
    footprint = smooth_step(0.52, 0.86, fbm_noise(world_u * 2.7 + seed_a, world_v * 2.35, 853, 5))
    albedo = broad * 10 + soft_cloud * 6 + fine_wear * 3 - line_a * 7 - line_b * 4 - footprint * 4.2
    height = broad * 0.011 + soft_cloud * 0.006 + fine_wear * 0.004 - line_a * 0.012 - line_b * 0.007
    return albedo, height


def fill_normal(heights: list[float], size: int, x_strength: float, y_strength: float) -> Image.Image:
    normal = Image.new("RGB", (size, size))
    pixels = normal.load()

    def height_at(px: int, py: int) -> float:
        return heights[((py + size) % size) * size + ((px + size) % size)]

    for y in range(size):
        for x in range(size):
            dx = (height_at(x - 1, y) - height_at(x + 1, y)) * x_strength
            dy = (height_at(x, y - 1) - height_at(x, y + 1)) * y_strength
            dz = 1.0
            length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
            pixels[x, y] = (
                round(((dx / length) * 0.5 + 0.5) * 255),
                round(((dy / length) * 0.5 + 0.5) * 255),
                round(((dz / length) * 0.5 + 0.5) * 255),
            )
    return normal


def generate(
    source_path: Path,
    albedo_path: Path,
    normal_path: Path,
    size: int,
    floor_size_m: float,
    slab_size_m: float,
    seam_width_m: float,
    seam_darkening: float,
    seam_depth: float,
    include_border_seams: bool,
    min_seam_pixels: float,
    seam_feather_pixels: float,
) -> None:
    source = Image.open(source_path).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    source_pixels = source.load()
    slab_count = max(1, round(floor_size_m / slab_size_m))
    slab_pixel_size = size / slab_count
    variants = create_slab_variants(slab_count)
    albedo = Image.new("RGB", (size, size))
    albedo_pixels = albedo.load()
    heights = [0.0] * (size * size)

    for y in range(size):
        for x in range(size):
            slab_xf = ((x + 0.5) / size) * slab_count
            slab_yf = ((y + 0.5) / size) * slab_count
            slab_x = min(slab_count - 1, math.floor(slab_xf))
            slab_y = min(slab_count - 1, math.floor(slab_yf))
            local_u = slab_xf - slab_x
            local_v = slab_yf - slab_y
            slab = variants[slab_y * slab_count + slab_x]
            u, v = transform_slab_uv(local_u, local_v, slab)
            sx = math.floor(wrap01(u) * 1024) % 1024
            sy = math.floor(wrap01(v) * 1024) % 1024
            sr, sg, sb = source_pixels[sx, sy]
            seam_core = saw_cut_mask(
                x,
                y,
                slab_pixel_size,
                slab_count,
                slab_size_m,
                seam_width_m,
                include_border_seams,
                min_seam_pixels,
                seam_feather_pixels,
            )
            wear_albedo, wear_height = slab_wear(local_u, local_v, slab, slab_x, slab_y)
            grain = hash_noise(x, y, 601) - 0.5
            source_luminance = (sr * 0.2126 + sg * 0.7152 + sb * 0.0722) / 255
            source_grain = (source_luminance - 0.5) * 12
            tone_offset = float(slab["tone_offset"])
            seam_darkening_amount = seam_core * seam_darkening
            surface_noise = grain * 3.2
            r = clamp(168 + source_grain + wear_albedo + tone_offset + surface_noise - seam_darkening_amount, 0, 255)
            g = clamp(167 + source_grain + wear_albedo + tone_offset + surface_noise - seam_darkening_amount, 0, 255)
            b = clamp(160 + source_grain + wear_albedo + tone_offset * 0.7 + surface_noise - seam_darkening_amount, 0, 255)
            albedo_pixels[x, y] = (round(r), round(g), round(b))
            luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255
            heights[y * size + x] = luminance * 0.1 + grain * 0.008 + wear_height + float(slab["height_bias"]) - seam_core * seam_depth

    normal = fill_normal(heights, size, 3.6, 3.6)
    albedo_path.parent.mkdir(parents=True, exist_ok=True)
    normal_path.parent.mkdir(parents=True, exist_ok=True)
    albedo.save(albedo_path, optimize=True)
    normal.save(normal_path, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="concrete_floor.jpg")
    parser.add_argument("--albedo", default="assets/industrial_concrete_floor_24m_2m.png")
    parser.add_argument("--normal", default="assets/industrial_concrete_floor_24m_2m_normal.png")
    parser.add_argument("--size", type=int, default=2048)
    parser.add_argument("--floor-size-meters", type=float, default=24)
    parser.add_argument("--slab-size-meters", type=float, default=2)
    parser.add_argument("--seam-width-meters", type=float, default=DEFAULT_SEAM_WIDTH_METERS)
    parser.add_argument("--seam-darkening", type=float, default=DEFAULT_SEAM_DARKENING)
    parser.add_argument("--seam-depth", type=float, default=DEFAULT_SEAM_DEPTH)
    parser.add_argument("--min-seam-pixels", type=float, default=0.2)
    parser.add_argument("--seam-feather-pixels", type=float, default=0.48)
    parser.add_argument(
        "--include-border-seams",
        action="store_true",
        help="Draw seams on texture borders so tiled renderers can show a joint at repeat boundaries.",
    )
    args = parser.parse_args()
    generate(
        Path(args.source),
        Path(args.albedo),
        Path(args.normal),
        args.size,
        args.floor_size_meters,
        args.slab_size_meters,
        args.seam_width_meters,
        args.seam_darkening,
        args.seam_depth,
        args.include_border_seams,
        args.min_seam_pixels,
        args.seam_feather_pixels,
    )
    print(f"Wrote {args.albedo}")
    print(f"Wrote {args.normal}")


if __name__ == "__main__":
    main()
