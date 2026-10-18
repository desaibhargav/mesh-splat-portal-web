# Measurement review

Reviewed SuperSplat's [Measure tool](https://github.com/playcanvas/supersplat/blob/main/src/tools/measure-tool.ts), its [surface picker](https://github.com/playcanvas/supersplat/blob/main/src/picker.ts), and the [user documentation](https://developer.playcanvas.com/user-manual/supersplat/editor/transform-measure-align/).

SuperSplat places two surface markers, stores them in the splat's local coordinates, and computes distance between their transformed world positions with `Vec3.distance`. It displays a connecting segment and a length label. Endpoints can be adjusted with PlayCanvas `TranslateGizmo`; entering a known length uniformly rescales the active splat. The implementation is MIT licensed but depends on SuperSplat's scene, events, PCUI panels, pivot, overlay renderer, and edit operations, so it is not a standalone component to import.

The portal uses PlayCanvas's existing `Picker` with depth enabled. `prepare` renders visible geometry and `getWorldPointAsync` reads a surface point at a screen coordinate. This supports mesh and splat picking through the engine; no CPU ray casting or physics dependency is required. The engine provides picking and vector math rather than a complete measurement UI. The portal projects endpoints with `CameraComponent.worldToScreen` into an SVG overlay for lines and labels, avoiding a font asset or additional UI framework.

## Current implementation

- A ruler tool places two endpoints with primary clicks, while retaining the same Alt/Option orbit, right-drag orbit, middle-drag pan, and wheel zoom as selection.
- Show the markers, a segment, and straight-line world-space distance. Shift-click starts another segment while retaining completed measurements. Clear removes all segments. Q/Escape exits placement mode while retaining visible measurements. F frames their endpoints, and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo and redo edits.
- Use asynchronous picks at the current canvas resolution; reject background clicks and results arriving after the tool or asset is closed.
- Respect currently isolated geometry. Preserve endpoints while navigating.
- Label uncalibrated assets in model units. Physical units require verified scale metadata or a known-distance calibration. Store calibration per asset rather than rescaling heritage geometry as a side effect of measuring.

Endpoint gizmos, saved measurements, additional measurement types, and calibration UI can follow once the two-point interaction is validated. Splat surface points are depth estimates from Gaussian rendering; this does not by itself establish survey accuracy.

Engine reference: [Picker](https://api.playcanvas.com/engine/classes/Picker.html).
