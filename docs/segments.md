# Segment workspace design — proposed, not implemented

A segment is a named region with an independent editing document. It references the same published mesh/splat geometry through a packed primitive mask; it is not a duplicate preservation asset. Isolation remains a temporary visibility filter in the parent document: its measurements and paint are still parent edits.

## Workflow

The Selection options offer Isolate and Create segment. The Segment tool opens with New segment or From existing selection (disabled without eligible selections). New segment uses the existing Box/Lasso/Brush interactions; converting a selection uses the same hover-highlight and click interaction as selection-bound annotations. Name and Save segment follow the common saved-items workflow. Saved entries above the options reopen segments for editing; the tree inventories them, controls visibility, and supports synchronized renaming. A clear workspace indicator and Return to asset action identify where edits will be stored.

Entering a saved segment switches to its own selection/paint, annotation, measurement, and undo/redo state. Existing tool components and operations are reused; there must not be separate segment versions of each tool. The parent document remains intact and is restored on return. Segment edits appear only in that segment workspace. Geometry stays shared, with subset index buffers for meshes and an engine-supported visibility mask for splats, rather than copying all vertex/texture data. Validate source buffer ownership and lifecycle in both formats before implementation.

The shared controller boundary must apply the segment mask to rendering, GPU ID/depth picking, X-ray selection, sectioning, measurement/annotation surface placement, and focus bounds. An unselected fragment outside a segment must not be pickable through a segment. Four panels and future XR input use this same scope. Do not simulate a segment by toggling isolation while leaving edits in the parent document.

## Library evaluation

PlayCanvas provides Mesh/MeshInstance resource sharing, subset index buffers, GPU picking, and scene transforms. These are rendering primitives, not a segmentation/document workflow, seed-growing algorithm, or general area/volume calculator. Check native splat visibility/edit hooks before adding custom machinery.

Slicer's Grow from seeds uses Fast GrowCut on image volumes, with competing seeded regions. Our meshes and splats are not voxel image volumes, so porting the effect directly would add voxelization, resolution, and reconstruction policy. Evaluate maintained surface-connectivity and point-cloud segmentation implementations against noisy scans and representative meshes/splats before choosing an algorithm. Keep seed growing separate from the initial manual segment workflow.

For geometric statistics, evaluate established geometry libraries such as VTK (including vtkMassProperties), then verify suitable JavaScript/WASM bindings or backend processing before choosing an integration. Do not assume VTK.js exposes every C++ VTK filter. Surface area needs a well-defined surface; enclosed volume needs a closed, consistently oriented, valid mesh. An open selected patch has no unique enclosed volume, and splat opacity is not a solid boundary. Do not infer physical units or silently cap holes/reconstruct surfaces. If reconstruction/capping is offered, expose its assumptions and distinguish estimates from original geometry.

References: [PlayCanvas mesh sharing](https://developer.playcanvas.com/user-manual/graphics/meshes/), [Slicer Segment Editor](https://slicer.readthedocs.io/en/latest/user_guide/modules/segmenteditor.html), [VTK MassProperties](https://vtk.org/doc/nightly/release/9.5/html/classvtkMassProperties.html).

## Required integration checks

Test create from gestures and saved selections, overlap, save/edit/rename/delete, visibility, and parent ↔ segment switching on mesh and splat assets. Paint and annotate inside a segment, measure after sectioning it, isolate a nested selection, undo/redo, and return to the parent: no segment record or paint may leak. Reopen and confirm preservation of the segment edits. Verify background/out-of-segment picks, active-drag cancellation, navigation away, four-view composition, shared GPU resource ownership, and desktop/stereo behavior. Report actual headset coverage separately.
