# Industrial Concrete Floor Assets

These textures are ready to reuse with `BABYLON.CreateGround`.

- `industrial_concrete_floor_24m_2m.png`: concrete albedo texture covering a 24 m x 24 m floor.
- `industrial_concrete_floor_24m_2m_normal.png`: matching normal map. Use `gammaSpace = false`.
- Slab joints are spaced every 2 m. The joint is a fine saw-cut style seam, tuned to about 5 mm before texture filtering.

For standard glTF/GLB scenes, create the ground in meters. A 24 m floor should therefore be `24 x 24` scene units. For millimeter-native host scenes such as the current VEB.js setup, pass `unitsPerMeter: 1000`; in that case a 24 m floor is `24000 x 24000` scene units.

For a larger floor, repeat the texture by scaling it with `widthMeters / 24` and `heightMeters / 24`; this keeps the seams at 2 m spacing.

Reusable helper:

```html
<script src="./snippets/industrialConcreteFloor.js"></script>
<script>
  const { ground, material } = createIndustrialConcreteFloor(scene, {
    widthMeters: 24,
    heightMeters: 24,
    y: 0
  });
</script>
```

Regenerate the assets from `concrete_floor.jpg`:

```bash
python3 tools/generate_industrial_floor_assets.py
```

Use different dimensions or seam tuning:

```bash
python3 tools/generate_industrial_floor_assets.py \
  --floor-size-meters 48 \
  --slab-size-meters 2 \
  --seam-width-meters 0.005 \
  --albedo assets/industrial_concrete_floor_48m_2m.png \
  --normal assets/industrial_concrete_floor_48m_2m_normal.png
```
