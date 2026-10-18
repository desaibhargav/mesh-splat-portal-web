# Shared viewer tools and engine reuse

Mesh and splat viewers supply the same `SelectionController` contract to `SelectionControls`. Rectangle/lasso/brush gestures, modifiers, navigation, shortcuts, palette UI, selection/paint history, measurement state, and annotation editing are shared. `MeshSelection` and `SplatSelection` implement geometry-specific visibility, mask updates, and rendering. Tool components do not branch by asset type to implement operations; the measurement panel only varies its unit explanation.

`ViewerTree` consumes the same small named/visible item contract for selections, measurements, and annotations. Selection masks stay bit-packed; measurement and annotation models own their immutable edit histories. Eye controls affect only derived scene visuals, and renaming does not modify source assets or annotation note content.

| Operation | Reused PlayCanvas API |
| --- | --- |
| Orbit, pan, zoom | Bundled `CameraControls` script |
| Place measurement/annotation endpoints | Depth-enabled `Picker.prepare` and `getWorldPointAsync`, through shared `SurfacePicker` / `useSurfacePick` |
| Visible region selection | `RenderPassPicker` for GPU triangle IDs or splat depth |
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

The runtime engine remains pinned in `package.json`. Embedded annotation layout has a small container adapter around the bundled manager; recheck it when upgrading the engine. Annotation markers use the viewer camera and the manager's native layers, without another camera or render pass. No editor framework or additional runtime dependency is imported.

The pinned camera-controls input source does not clear held keyboard modifiers when the browser loses focus. `ViewerCamera` contains the narrow compatibility guard: it releases accumulated Shift/Ctrl state on blur and reconciles it with the next pointer event. Tool gestures consume their own captured pointer events, so they no longer disable and re-enable the complete camera script.
