# Segments

Segments are session-local editing workspaces over a named region of the published asset. Each workspace owns selections/paint and their history, annotations, measurements and appearance, views, sections, and camera/asset orientation. The active workspace uses the existing shared tools; there are no separate mesh/splat or segment versions of them.

## Workflow

- In Selection, select a region and click **Create segment**. Enter a name and **Save segment**; saving the parent selection first is optional.
- Or open the **Segment** toolbar tool. **New segment** reuses Box/Lasso/Brush, X-ray, and selection modifiers. **From existing selection** reuses the annotation workflow's GPU hover highlight and click to choose a region. It is disabled without eligible selections.
- Saving opens the segment workspace. The **Segment: …** indicator and **Return to asset** action make its scope explicit. Q/Escape exits the active tool to navigation while remaining in that workspace. F in navigation frames that segment.
- Use Selection, Measurement, Annotate, Views, and Cross section normally inside the segment. Their edits belong only to that workspace. Isolation remains a temporary visibility filter inside whichever workspace is active; it does not create an independent document.
- The saved **Segments** box above the tool options opens/deletes entries. Opening a saved segment restores its document; **Update segment** renames it. Its boundary is fixed after creation; create another segment to define a different boundary. Creating a segment inside another segment is allowed only within the current region; the resulting workspace still has independent edits.
- The model tree lists segments and synchronizes renaming. Its eye changes visibility without opening editors or moving the camera. Hiding the active segment hides its geometry and tool visuals; showing it restores them. Visibility flags on other segments are retained for their next opening. Segment paint/annotations/measurements are never composited onto the parent asset.
- Returning restores the full-asset document and its camera/asset orientation. Saved selections survive; unsaved selection drafts follow the ordinary Q/navigation cleanup policy. Nothing is written to the master asset or backend. These records last until the asset is left; persistent views remain deferred.

## Engine reuse and cost

`SegmentWorkspaces` owns documents and switches the existing selection controller's scope. Primitive IDs remain those of the one published derivative; no ID correspondence, geometric extraction, or master access is required.

Mesh subsets borrow the original PlayCanvas vertex buffers and materials' texture assets, owning only subset index buffers/material state. Rendering, triangle-ID picking, previews, X-ray selection, and focus bounds honor the same region mask. Segment creation does not instantiate another GLB or viewer.

Splats share the native GSplat resource and textures. One additional nearest-filtered R8 scope texture per viewer drives the existing PlayCanvas work-buffer modifier (GLSL and WGSL); alpha is suppressed outside the active region. It is uploaded on workspace/visibility changes, not per pointer move or frame. Picking/depth rendering uses this same visible resource, and selection masks are constrained to the scope. Geometry/resource memory is not multiplied by segment count. The extra texture costs one byte per native texture texel; inactive segments retain packed masks and ordinary edit data rather than GPU scenes.

Workspace switching performs bounded mask/paint work and rebuilds active subsets; there is no added per-frame traversal of inactive documents or extra segment render pass. Full-size paint arrays remain immutable and share unchanged data/history buffers. Pending selection/paint results check workspace ownership before applying. Existing tool components unmount their scene visuals/listeners on a document switch; the asset renderer stays mounted.

The shared document/selection operations are usable by future XR input and do not require DOM coordinates. Current gesture and panel presentation remains the portal's desktop UI; actual immersive sessions, XR controls/world-space menus, Safari, and WebGPU are unverified. Engine use alone does not establish headset compatibility.

## Scope and verification

This version deliberately excludes seed growing and area/volume calculations. It does not close holes, reconstruct surfaces, split vertices, or repair the existing dense visible-only selection coverage limitation.

`SegmentWorkspaces.test.ts` checks independent documents/history, parent paint restoration, visibility, deletion, and invalid/out-of-scope regions. The maintained real-browser integration test uses the ordinary published `21e231-006699` mesh and `sakura-garden` splat, with Puppeteer from the backend's existing development dependency:

```bash
# First run a development server or production preview.
VIEWER_BASE=http://127.0.0.1:5175 npm run test:browser:segments
```

The fixture server listens only on localhost and exposes only those derivative directories; catalog responses are intercepted without a database or credentials. Screenshots go to the system temporary directory, overridable with `SEGMENT_TEST_OUTPUT`. The suite exercises both entry points, hover-to-convert, shared mesh buffers, independent paint/annotation/measurement records, out-of-segment surface rejection, X-ray constraints, saved view → section → measurement in four panels, Space maximize/restore, workspace recall, tree visibility/rename, and deletion. Development and minified production workflows passed on both fixtures, including a deliberately delayed native GPU read across a document switch and segment-local undo/redo. Separate native dual-camera checks passed for scoped geometry, sectioning, and measurement visuals; these are not immersive-session tests. Run the suite on both builds and inspect screenshots after changes. The ordinary saved-tool browser workflow must also pass after document-ownership changes. See [browser verification](browser-verification.md).
