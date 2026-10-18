# Viewer roadmap

## Next: measurement

Implementation review: [docs/measurement.md](docs/measurement.md).

- Add a two-point distance tool for meshes and splats, using PlayCanvas GPU surface picking.
- Show endpoints, a segment, and its world-space length; keep navigation available while measuring.
- Establish per-asset units or a known-distance calibration before labeling scan distances as physical units.
- Review SuperSplat's MIT-licensed measurement interaction; reuse engine APIs without importing its editor framework.

## Deferred

- Selection accuracy: improve missed triangles in visible-only GPU picking, especially on dense meshes at distant zoom. Compare coverage approaches without reintroducing CPU ray casting.
- Thumbnails: improve automatic framing, view choice, and consistent neutral lighting.
- Turntable previews: generate discrete views for an interactive catalog preview; revisit thumbnail rendering as part of this work.
- Sectioning / clipping planes.
- Appearance controls, including tint and opacity.
