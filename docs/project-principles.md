# Project principles

These are the owner's standing preferences for the mesh/splat visualization suite. Read them when continuing work in a new session. They describe design intent; consult the code and repository documentation for what is actually implemented. Each repository's `AGENTS.md` carries the essential instructions for standalone checkouts.

## One experience across asset formats and devices

Meshes and Gaussian splats should have the same tools, controls, gestures, shortcuts, state transitions, history, and user experience. Share operations and contracts; isolate unavoidable geometry, renderer, and file-format differences in narrow adapters. Apply the same principle to backend ingestion, validation, catalog publication, and delivery, dispatching only the format-specific processing stages.

Desktop and future WebXR should use the same tool operations and scene visuals. Adapt input and presentation to the device rather than building a separate editor. Measurement visuals already use native scene primitives; browser panels, annotation presentation, controller bindings, and XR sessions still need work. Stereo rendering checks do not establish headset compatibility.

## Reuse the engine and keep code small

Prefer PlayCanvas APIs, bundled scripts, official React integration, and suitable maintained React/open-source libraries whenever they provide the required function. Inspect installed versions and official examples/source before claiming support. Reuse focused capabilities rather than importing an entire editor or forking SuperSplat for a small tool. Document real gaps and keep necessary custom code small.

Avoid duplicate mesh/splat tool implementations, speculative frameworks, dead code, unnecessary dependencies, and fallback chains that hide errors. Avoid brittle asset-specific branches and hardcoded IDs, paths, geometry limits, or camera assumptions. Derive asset behavior from metadata and bounds. Keep legitimate configuration, palette/style choices, and processing policy centralized; meaningful mathematical constants are not a reason to add configuration.

Prefer public APIs. Isolate unavoidable adapters around pinned engine scripts, document why they exist, and review them on upgrades. Fix initialization and lifecycle ordering at their source rather than adding arbitrary delays or asset-specific exceptions.

## Efficient interaction and explicit ownership

Use engine GPU picking and rendering for dense assets. Do not reintroduce CPU rays per candidate face for box, lasso, or brush selection. Reuse buffers, geometry, materials, and font atlases. Avoid copying entire assets for each selection or color; keep masks and undo state compact and share unchanged data. Perform edit work on edits rather than every frame; camera-facing visuals naturally update with the camera.

Give resources clear owners and release them before the graphics device is destroyed. Discard pending asynchronous results when their viewer or operation is gone. Test navigation away and repeated mounting as well as the happy path.

## Consistent editing workflow

- Use icon tools and contextual actions. Selection actions belong at the bottom right.
- Q/Escape returns to navigation; ordinary typing and text editing retain their shortcuts.
- Allow navigation during tool use: Alt/Option-left-drag or right-drag orbits, middle-drag pans, and the wheel zooms.
- F frames the relevant selection/object or measurement and updates the orbit pivot.
- Share selection modifiers and Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z undo/redo behavior across formats.
- Support select → color → annotate directly, without requiring Q between tools. Switching tools preserves selection; annotations retain independent region snapshots.
- Render user notes as plain text. Keep edits non-destructive to source assets.

These are conventions to preserve, not a claim that every future tool already implements every operation. Current behavior and limits are described in the README and viewer-tool documentation.

## Heritage accuracy and security

Use neutral studio lighting for meshes and preserve splats' captured appearance. Do not infer physical scale from object size or assume a scan is calibrated merely because its format defines units. Display unverified distances without a unit; append mm, m, or another unit only when the asset has explicit calibration. Gaussian surface picks are estimates, not survey measurements.

Preservation masters and private processing manifests remain outside public delivery. Serve only authorized derivatives and thumbnails through the intended gateway. Security must hold even with a public repository and known directory layout; hiding paths or omitting a download button does not protect browser-delivered data. Keep credentials, private records, and environment secrets out of commits and saved-view exports.

## Delivery and scope

Review both repositories when a change crosses their boundary. Implement one feature family at a time, run proportionate meaningful checks, and report what changed, what was verified, and material remaining limits. Do not present proposals as shipped behavior or claim testing that was not performed.

Commit and push reusable code, then pull and deploy on AWS. Heavy derivative and thumbnail processing currently runs on macOS; transfer outputs with checksums and publish with the catalog script. Keep AWS focused on serving. Read current deployment configuration rather than reusing historical public IPs. Keep temporary processing/browser scripts outside the repositories; do not commit original assets, generated derivatives, or private manifests as code.

The owner prefers autonomous completion of authorized work without repeated confirmation. This does not bypass actual environment permission requirements or authorize unrelated destructive actions.

## Deferred work

[TODO.md](../TODO.md) tracks saved views, WebXR, small-triangle selection accuracy, thumbnail framing, turntable previews, calibration, sectioning, and further appearance tools. Saved views should store validated view data tied to the asset/derivative revision, without duplicating models; local browser storage and export/import are the planned starting point. These remain deferred unless explicitly brought into scope.
