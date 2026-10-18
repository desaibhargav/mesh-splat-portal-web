# Sectioning research

Status: researched, not implemented. Selection toolbar consolidation is independent of this work.

The shared [Views tool](views.md) now supplies named, session-local reference frames. Sectioning can use each frame's origin and quaternion: its local X/Y axes define the plane, +Z its normal. Offset moves along that normal, the two tilts rotate around the reference X/Y axes, and flip changes the retained side. Axis/face/three-point alignment remains future work. View gizmos never transform source geometry.

## Engine reuse

PlayCanvas supplies the rendering primitives for sectioning, but the installed engine (2.21.4) has no bundled Acrobat-style sectioning tool or React panel to wire in directly.

The official [Gaussian-splat clipping example](https://github.com/playcanvas/engine/blob/main/examples/src/examples/gaussian-splatting/clipping.example.mjs) is a closer reference than the [paint example](https://github.com/playcanvas/engine/blob/v2.21.4/examples/src/examples/gaussian-splatting/paint.example.mjs). Paint uses `GSplatProcessor` and a work-buffer modifier to update splat colors. Clipping uses `gsplatModifyVS`, `gsplatModifyPS`, and a custom varying stream: classify each splat against a box, then run the per-fragment boundary test only for intersecting splats. Both GLSL and WGSL sources are provided. The current official example may use newer convenience APIs; adapt to the installed version rather than copying its application setup.

The installed engine has these splat shader hooks and varying streams. Our existing selection/color modifier must be composed with clipping rather than replaced. For a sharp boundary, clipping the footprint in the fragment stage is preferable to simply hiding splats whose centers lie beyond the plane.

For meshes, use the existing `StandardMaterial` shader-chunk hooks and the world-space position to discard fragments on the removed side of the plane. Apply the same plane to selection-preview materials and picker/depth rendering so hidden geometry cannot still be selected or measured. The engine's `Plane`, math types, and scene primitives can represent and display the plane; the `Plane` math class itself does not clip render geometry.

## Proposed first increment

Use one Section tool and shared state/options for meshes and splats: enable/disable, X/Y/Z alignment, offset derived from asset bounds, flip the retained side, tilt, and an optional translucent cutting-plane guide. Q exits manipulation without implicitly changing the section state. Keep normal navigation available.

This mirrors the main controls in [Acrobat's cross-section documentation](https://helpx.adobe.com/acrobat/using/interacting-3d-models.html#create_cross_sections). Shared operations should dispatch only the necessary mesh/splat rendering differences. Drive GPU plane uniforms when controls change; avoid CPU triangle cutting, geometry rebuilding, or uploading entire asset buffers while dragging a plane.

Filled section caps and intersection contours are a separate increment. A clipping shader alone does not fill the opening, and a scanned surface or Gaussian splat does not establish a solid interior. Define the representation and heritage-accuracy requirements before presenting caps as interior geometry. Saved section views belong with the deferred saved-view work.

Test clipped visual output, both plane sides, tilted planes, boundaries, dense assets, isolated/colored selections, annotation placement, and measurement picks in a real browser on both asset types before shipping. Scene rendering is the right basis for future XR, but headset verification remains separate.
