# Project principles

These are the owner's standing preferences for the mesh/splat visualization suite. Read them when continuing work in a new session. They describe design intent; consult the code and repository documentation for what is actually implemented. Each repository's `AGENTS.md` carries the essential instructions for standalone checkouts.

## One experience across asset formats and devices

Meshes and Gaussian splats should have the same tools, controls, gestures, shortcuts, state transitions, history, and user experience. Share operations and contracts; isolate unavoidable geometry, renderer, and file-format differences in narrow adapters. Apply the same principle to backend ingestion, validation, catalog publication, and delivery, dispatching only the format-specific processing stages.

Desktop and future WebXR should use the same tool operations and scene visuals. Adapt input and presentation to the device rather than building a separate editor. Measurement visuals already use native scene primitives; browser panels, annotation presentation, controller bindings, and XR sessions still need work. Stereo rendering checks do not establish headset compatibility.

WebXR is a first-class portal experience and a design requirement for every new feature. Account for immersive presentation, stereo/per-eye cameras, controller or hand input, and access to tool options from the outset. Share the underlying operations with desktop and prefer suitable PlayCanvas scene and XR APIs. Engine reuse alone does not guarantee XR compatibility: verify the relevant behavior, distinguish stereo checks from actual immersive-session tests, and explicitly document and track any missing or unverified XR support. Do not silently make a new feature desktop-only or build speculative XR infrastructure merely to claim compatibility.

## Reuse the engine and keep code small

Prefer PlayCanvas APIs, bundled scripts, official React integration, and suitable maintained React/open-source libraries whenever they provide the required function. Inspect installed versions and official examples/source before claiming support. Reuse focused capabilities rather than importing an entire editor or forking SuperSplat for a small tool. Document real gaps and keep necessary custom code small.

Avoid duplicate mesh/splat tool implementations, speculative frameworks, dead code, unnecessary dependencies, and fallback chains that hide errors. Avoid brittle asset-specific branches and hardcoded IDs, paths, geometry limits, or camera assumptions. Derive asset behavior from metadata and bounds. Keep legitimate configuration, palette/style choices, and processing policy centralized; meaningful mathematical constants are not a reason to add configuration.

Prefer public APIs. Isolate unavoidable adapters around pinned engine scripts, document why they exist, and review them on upgrades. Fix initialization and lifecycle ordering at their source rather than adding arbitrary delays or asset-specific exceptions.

For nontrivial geometry algorithms, investigate established domain libraries before implementing one ourselves. Compare correctness, numerical robustness and degenerate inputs, performance, maintenance, bundle impact, and integration cost. A short custom implementation is not automatically preferable to a hardened implementation. Reuse existing PlayCanvas math for elementary operations; consider libraries such as JSCAD, math.gl, or VTK.js when a genuine geometry capability is missing. In particular, evaluate robust library implementations before tackling intersections, topology changes, or filled section caps.

Library reuse is primarily about accumulated correctness and coverage beyond our small asset collection and single-user testing, not saving lines. Investigate the full input family before writing an implementation around the examples currently available: those examples are a regression set, not the specification. When an engine's public API lacks the needed boundary, evaluate established domain libraries before building a narrower custom substitute. For example, PLY recovery should reuse a decoder's scalar/list and ASCII/binary support, with application code limited to record retention and recovery policy. Prefer maintained implementations; inspect real adoption, relevant downstream fixes, and API behavior rather than treating stars as a correctness guarantee. Verify the specific API's guarantees: broad format support does not imply strict validation or damaged-file recovery. When adapting upstream code, preserve its license/attribution, record its source revision and local changes, keep adaptations narrow, and test alternate layouts, malformed inputs, numerical fidelity, and our multi-view/XR requirements where applicable. A copied implementation becomes our maintenance responsibility; it does not automatically inherit future upstream fixes.

## Efficient interaction and explicit ownership

Use engine GPU picking and rendering for dense assets. Do not reintroduce CPU rays per candidate face for box, lasso, or brush selection. Reuse buffers, geometry, materials, and font atlases. Avoid copying entire assets for each selection or color; keep masks and undo state compact and share unchanged data. Perform edit work on edits rather than every frame; camera-facing visuals naturally update with the camera.

Treat performance as a correctness requirement. Before adding per-frame work, another render pass, a full-mask traversal, or a dependency, establish that it is necessary and bound its cost to the smallest relevant data. Prefer edit-time work, GPU operations, incremental updates, and shared resources. Fix the owning-state or lifecycle problem at its source; do not accumulate timing patches, fallback chains, duplicated implementations, or asset-specific exceptions. When an engine adapter is unavoidable, keep it narrow, state why it exists, document its runtime cost, and remove it if the upstream API later supplies the required boundary.

Give resources clear owners and release them before the graphics device is destroyed. Discard pending asynchronous results when their viewer or operation is gone. Test navigation away and repeated mounting as well as the happy path.

## Consistent editing workflow

- Use explicit Save actions and a saved-items box above each tool’s options for selections, annotations, measurements, views, and sections. Open entries there to edit/update/delete them. The model tree inventories scene records and controls visibility; renaming is allowed there and must synchronize with the saved list and any open editor. Tree rows must not activate tool editors or move the camera.
- Use icon tools and contextual actions. Selection actions belong at the bottom right.
- Q/Escape returns to navigation; ordinary typing and text editing retain their shortcuts.
- Allow navigation during tool use: Alt/Option-left-drag or right-drag orbits, middle-drag pans, and the wheel zooms.
- Viewer layouts belong to the shared workspace. Route tools through the active viewport rather than adding independent multi-view implementations inside each tool. Share model/document data and allocate camera-facing visuals only for visible views.
- F frames the active selection only in the Selection tool; after exiting that tool it frames the entire asset. In Measurement it frames measurement endpoints, falling back to the asset when empty. Focus updates the orbit pivot. Keep text input shortcuts intact; avoid duplicate focus buttons.
- Share selection modifiers and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo/redo behavior across formats.
- Support select → color → annotate directly, without requiring Q between tools. Switching tools preserves selection; annotations retain independent region snapshots.
- Render user notes as plain text. Keep edits non-destructive to source assets.

These are conventions to preserve, not a claim that every future tool already implements every operation. Current behavior and limits are described in the README and viewer-tool documentation.

## Heritage accuracy and security

Use neutral studio lighting for meshes and preserve splats' captured appearance. Do not infer physical scale from object size or assume a scan is calibrated merely because its format defines units. Display unverified distances without a unit; append mm, m, or another unit only when the asset has explicit calibration. Gaussian surface picks are estimates, not survey measurements.

Preservation masters and private processing manifests remain outside public delivery. Serve only authorized derivatives and thumbnails through the intended gateway. Security must hold even with a public repository and known directory layout; hiding paths or omitting a download button does not protect browser-delivered data. Keep credentials, private records, and environment secrets out of commits and saved-view exports.

## Delivery and scope

Review both repositories when a change crosses their boundary. Implement one feature family at a time, run proportionate meaningful checks, and report what changed, what was verified, and material remaining limits. Do not present proposals as shipped behavior or claim testing that was not performed.

For viewer and UI bug fixes, real browser interaction testing is required before saying "fixed." Reproduce the reported workflow before changing it, then repeat it afterward using real pointer/keyboard input and representative assets. Verify the rendered result, not just a status label, internal state, or camera transform; capture screenshots and browser/render errors. Exercise shared tools on both mesh and splat assets, including relevant save/edit/delete, navigation, and teardown paths. Tests and a production build supplement this check rather than replace it. If browser verification is blocked, state the limitation and describe the change as unverified. The repeatable procedure and available tools are documented in [browser verification](browser-verification.md).

Integration and composability tests are required for new features. Identify the existing tools and shared state the feature affects, then test realistic combined workflows on meshes and splats rather than testing each tool only in isolation. Examples include section → measure an exposed surface and select → paint → annotate → focus → navigate. Check rendering/picking agreement, preservation of independent selections and edits, tool switching, relevant undo/redo, visibility/isolation, and resource cleanup. Use focused automated tests for shared contracts and real browser interactions against the production build for visible cross-tool results. Cover affected combinations proportionately; avoid an exhaustive Cartesian test matrix or tests that merely mirror implementation. Report any unavailable integration or XR coverage explicitly.

Commit and push reusable code, then pull and deploy on AWS. Heavy derivative and thumbnail processing currently runs on macOS; transfer outputs with checksums and publish with the catalog script. Keep AWS focused on serving. Read current deployment configuration rather than reusing historical public IPs. Keep temporary processing/browser scripts outside the repositories; do not commit original assets, generated derivatives, or private manifests as code.

The Mac processing arrangement is temporary; the intended future home for the complete pipeline is AWS. Preserve Linux portability and document platform-specific dependencies and unverified behavior as explicit migration gaps. Do not equate successful AWS serving with tested AWS processing. Before moving processing, verify clean native builds, the complete derivative/thumbnail/publication workflow, and resource capacity on the target instance; the backend README tracks the currently unverified RPly/Linux migration checks.

The owner prefers autonomous completion of authorized work without repeated confirmation. This does not bypass actual environment permission requirements or authorize unrelated destructive actions.

## Deferred work

[TODO.md](../TODO.md) tracks saved views, WebXR, small-triangle selection accuracy, thumbnail framing, turntable previews, calibration, sectioning, and further appearance tools. Saved views should store validated view data tied to the asset/derivative revision, without duplicating models; local browser storage and export/import are the planned starting point. These remain deferred unless explicitly brought into scope.
