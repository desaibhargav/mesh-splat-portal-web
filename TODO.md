# Viewer roadmap

## Deferred

- Measurement: per-asset units or known-distance calibration, editable endpoints, and saved measurements. Current implementation: [docs/measurement.md](docs/measurement.md).

- Selection accuracy: improve missed triangles in visible-only GPU picking, especially on dense meshes at distant zoom. Compare coverage approaches without reintroducing CPU ray casting.
- Thumbnails: improve automatic framing, view choice, and consistent neutral lighting.
- Turntable previews: generate discrete views for an interactive catalog preview; revisit thumbnail rendering as part of this work.
- Sectioning / clipping planes.
- Appearance controls, including tint and opacity.
