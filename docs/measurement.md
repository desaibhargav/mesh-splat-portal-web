# Measurement review

Reviewed SuperSplat's [Measure tool](https://github.com/playcanvas/supersplat/blob/main/src/tools/measure-tool.ts), its [surface picker](https://github.com/playcanvas/supersplat/blob/main/src/picker.ts), and the [user documentation](https://developer.playcanvas.com/user-manual/supersplat/editor/transform-measure-align/).

SuperSplat places two surface markers, stores them in the splat's local coordinates, and computes distance between their transformed world positions with `Vec3.distance`. It displays a connecting segment and a length label. Endpoints can be adjusted with PlayCanvas `TranslateGizmo`; entering a known length uniformly rescales the active splat. The implementation is MIT licensed but depends on SuperSplat's scene, events, PCUI panels, pivot, overlay renderer, and edit operations, so it is not a standalone component to import.

The portal uses PlayCanvas's existing `Picker` with depth enabled. `prepare` renders visible geometry and `getWorldPointAsync` reads a surface point at a screen coordinate. This supports mesh and splat picking through the engine; no CPU ray casting or physics dependency is required. The engine provides picking and vector math rather than a complete measurement UI. The portal renders solid measurement lines with PlayCanvas's batched `WideLineRenderer`, plus native sphere entities, world-space text elements, and a shared `CanvasFont` atlas. Screen-space line width stays stable in perspective and orthographic panels. PlayCanvas renders the same scene for each eye; there is no separate SVG or XR measurement renderer.

## Scene rendering

`MeasurementRenderer` contains the scene visuals for both meshes and splats; `MeasurementVisuals` connects it to the shared measurement state. Font glyphs and the white unlit material are shared, unchanged segments retain their entities, and sliders update line width and font size without rebuilding renderer resources. Text, lines, and markers use a dedicated layer with a fresh depth buffer so measurements remain readable over the model. Picking is restricted to the asset's layers, so measurement and annotation visuals cannot become measurement endpoints.

Label styling comes from the viewer's CSS variables. The font atlas uses PlayCanvas's documented 32-pixel glyph size with the browser's existing font family. Scene resources are released on application destruction before the graphics device, including navigation during a pick.

These are XR-renderable visuals. XR session entry, controller input, and XR control panels remain a separate roadmap item; headset validation is still required.

## Current implementation

- A ruler tool places two endpoints with primary clicks, while retaining the same Alt/Option orbit, right-drag orbit, middle-drag pan, and wheel zoom as selection.
- Show the markers, a segment, and straight-line world-space distance. Shift-click starts another segment while retaining completed measurements. Clear removes all segments. Q/Escape exits placement mode while retaining visible measurements. F frames their endpoints, and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo and redo edits.
- Use asynchronous picks at the current canvas resolution; reject background clicks and results arriving after the tool or asset is closed.
- Respect currently isolated geometry. Preserve endpoints while navigating.
- Leave uncalibrated distances unitless. Append a physical unit only with verified scale metadata or a known-distance calibration. Store calibration per asset rather than rescaling heritage geometry as a side effect of measuring.

**Save measurement** keeps the line, endpoints, and value in the scene and adds its name to the saved-measurements box above the options and to the model tree. Clicking a saved entry shows its two native `TranslateGizmo` handles for editing; saving/updating closes those handles without hiding the measurement. The tree eye hides/shows it, and the saved-list minus button deletes it. Records remain local to this asset session; persistent storage is still deferred. Shift-click saves the current completed segment and starts another.

Dragging an endpoint snaps its proposed screen position onto the visible retained model surface through the shared `SurfacePicker`. Only the selected measurement has gizmos, on the active panel camera. The depth target renders once per gesture; coalesced single-pixel GPU reads reuse it while the camera/model are fixed. Invalid/background drops restore the original endpoint. A committed drag creates one undo entry, and previews reuse line/text entities rather than rebuilding geometry. Q, cancellation, scene orientation/layout changes, and teardown cancel pending edits and release navigation. Gizmos are mouse/touch driven; XR controller/hand bindings remain deferred and should call the same `moveEndpoint` operation.

Distance labels stay horizontal and offset toward the upper side of the projected line (beside a vertical line). Clearance uses the native text width, font height, line thickness, and CSS gap so larger text does not overlap the line. Projection uses the active camera and viewport. Additional measurement types and calibration UI remain deferred. Splat surface points are depth estimates from Gaussian rendering; this does not by itself establish survey accuracy.

Engine reference: [Picker](https://api.playcanvas.com/engine/classes/Picker.html).

Development and minified-production Chromium checks cover save/reopen without hiding, both asset formats, surface-snapped native handle drags, one-entry undo/redo, background rejection, model-tree hide/show, deletion, four-view edits, Q cancellation, and leaving with handles active. A known cube fixture also checks a sectioned span and an endpoint dragged along its retained face. A browser counter verifies one depth-image capture per drag. These checks do not establish Safari, WebGPU, or actual XR-controller compatibility.
