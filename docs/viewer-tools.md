# Shared viewer tools and engine reuse

Mesh and splat viewers supply the same `SelectionController` contract to `SelectionControls`. Rectangle/lasso/brush gestures, modifiers, navigation, shortcuts, palette UI, selection/paint history, measurement state, and annotation editing are shared. `MeshSelection` and `SplatSelection` implement geometry-specific visibility, mask updates, and rendering. Tool components do not branch by asset type to implement operations; unit calibration remains a separate metadata concern.

`ViewerTree` consumes the same small named/visible item contract for selections, measurements, annotations, saved views, and saved sections. View/section snapshots share a small session preset collection; renaming a snapshot never activates it. Each tool has an explicit Save operation and a saved-items box above its options. Selection gestures/paint keep internal draft regions for rendering, overlapping paint, and annotation binding; only explicitly saved selections appear in the saved list and tree. Saving promotes the region with its packed mask and paint metadata; Update selection replaces that record without duplicating it. Clicking a saved selection restores its mask and leaves previous isolation, so Isolate can target that region. The model tree handles visibility and renaming only; names synchronize into lists and open editors. Section eye controls apply the saved cut without restoring the camera or opening the editor. Reopening a section from its saved box restores its camera/orientation and offers Update section. Selection masks stay bit-packed; measurement and annotation models own their immutable edit histories. Eye controls affect only derived scene visuals, and renaming does not modify source assets or annotation note content.

| Operation | Reused PlayCanvas API |
| --- | --- |
| Four-view workspace | Native cameras with `rect`/`scissorRect`, one scene and shared tools; [implementation and limits](viewports.md) |
| Orbit, pan, zoom | Bundled `CameraControls` script |
| Cross sections | `Plane`, `Quat`, `BoundingBox`, `StandardMaterial` shader hooks, splat shader chunks, and a scene plane; [implementation and limits](sectioning.md) |
| Saved views and orientation | `RotateGizmo`, shared parent `Entity`, `ViewCube`, `Pose`, camera projection, and `AppBase.drawLines`; [workflow and camera adapter](views.md) |
| Place measurement/annotation endpoints | Depth-enabled `Picker.prepare` and `getWorldPointAsync`, through shared `SurfacePicker` / `useSurfacePick` |
| Visible region selection | `RenderPassPicker` for GPU triangle IDs or splat depth |
| Edit measurement endpoints | Native `TranslateGizmo` plus the shared GPU surface picker; one cached depth image per drag and one undoable commit |
| Measurement visuals | Built-in cylinder/sphere render primitives, world-space text elements, `CanvasFont`, and `Layer` |
| Annotation hotspots and tooltips | Bundled `Annotation` and `AnnotationManager` scripts; picker render IDs for bound-region hover |
| Mesh region colors | `StandardMaterial`, `Mesh`, `MeshInstance`, and `Layer` with shared vertex data and index subsets |
| Splat region colors | `GSplatComponent.setWorkBufferModifier`, an RGBA paint texture, and `WORKBUFFER_UPDATE_ONCE` |

## Paint example review

The official [paint example](https://github.com/playcanvas/engine/blob/main/examples/src/examples/gaussian-splatting/paint.example.mjs) uses `Picker` for surface positions, `GSplatProcessor` to paint a spherical brush into a `customColor` instance stream, and `setWorkBufferModifier` to combine that stream with the original color. It requests work-buffer updates after painting.

Our color operation applies an arbitrary sRGB shade to an existing selection mask. Immutable packed CPU colors provide immediate undo state; GPU work-buffer modification applies them to splats. A spherical brush processor would add a different operation and is unnecessary for this selection-based action. PlayCanvas does not supply the portal's color picker, selection state, or undo UI.

A spherical brush affects Gaussian centers within a 3D radius around a picked surface point. Our current brush selects inside a screen-space circle, with the chosen visible-only/X-ray policy. A sphere can also reach nearby surfaces inside its radius; it does not itself enforce front-surface visibility. It could support depth-local painting or future XR interaction, but is not required for select → color → annotate and is not a fix for tiny-triangle picking.

## Desktop and XR

Measurement state and visuals use one implementation for both asset formats and camera modes. White cylinder lines, sphere endpoints, and text are ordinary scene elements; projection and stereo rendering belong to the engine. The browser tool panels and annotation tooltip still require XR presentation and controller bindings when XR sessions are implemented. Those bindings should call the existing shared operations.

The runtime engine remains pinned in `package.json`. Embedded annotation layout has a small container adapter around the bundled manager; recheck it when upgrading the engine. Annotation markers use each visible viewport camera and the manager's native layers, without a dedicated annotation camera or render pass. Camera-facing visuals are replicated per visible panel; records and region masks stay shared. No editor framework or additional runtime dependency is imported.

`ViewerAnnotationManager` retains one engine mesh reference for its shared marker plane. Without that owner reference, replacing the last draft marker destroys the plane through `MeshInstance.destroy`, and the bundled manager reuses its destroyed vertex buffer for the saved marker. This causes repeated render exceptions that look like frozen navigation. The manager releases its reference on teardown; a regression test exercises the real mesh reference-counting behavior.

Selection binding snapshots the hovered area during pointer capture before the hover handler clears it, then commits on release without consuming the navigation events. Hover uses one outstanding GPU readback with no debounce delay. Mesh hover caches region index overlays sharing the original vertex data; entering a cached region switches instance visibility without rebuilding display geometry or invalidating the picker. Splat hover uploads its mask only when the hovered region changes. Cached previews are released on geometry edits and viewer teardown.

The pinned camera-controls input source does not clear held keyboard modifiers when the browser loses focus. `ViewerCamera` contains the narrow compatibility guard: it releases accumulated Shift/Ctrl state on blur and reconciles it with the next pointer event. Tool gestures consume their own captured pointer events, so they no longer disable and re-enable the complete camera script.

Measurement slider reset buttons restore the shared default line width and font size independently. Native endpoint gizmo size compensates for camera viewport height, keeping handles readable in four-panel layouts without additional geometry or render passes.

Focus is contextual: F frames the current mask in Selection, otherwise the entire asset (including after Q), with Measurement retaining its endpoint focus. Empty selections/measurements fall back to whole-asset bounds. The annotation form has no duplicate focus button. Stored selections remain available without affecting navigation focus.
