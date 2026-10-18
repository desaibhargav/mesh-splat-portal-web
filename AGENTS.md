# Project instructions

Read [project principles](docs/project-principles.md) before changing this project. They record the owner's standing preferences, including the shared mesh/splat experience and future WebXR direction. See [viewer tools](docs/viewer-tools.md) for current engine reuse and [TODO](TODO.md) for deferred work.

- Keep mesh and splat controls, tool state, gestures, history, and operations shared. Put necessary geometry differences behind the existing controller interfaces. XR input should call these same operations.
- Reuse installed PlayCanvas APIs, bundled scripts, official React integration, and suitable maintained libraries before writing custom machinery. Check the installed version and source; explain genuine API gaps.
- Keep code lean and general. Avoid speculative abstractions, duplicate implementations, fallback chains, asset-specific constants, and scattered special cases. Derive behavior from metadata or geometry; centralize actual policy and style settings.
- Preserve GPU-based dense selection and reuse graphics resources. Make ownership, async cancellation, and teardown explicit; destroy resources while their graphics device is alive.
- Treat performance as correctness: justify and bound per-frame work, render passes, full-mask traversals, and dependencies. Fix ownership and lifecycle faults at the source instead of stacking timing patches, fallback chains, or asset-specific exceptions.
- Keep source assets unchanged by viewer edits. Do not guess physical calibration. Enforce asset security on the server rather than relying on hidden paths or a missing download button.
- Implement features incrementally, verify relevant behavior on both formats, and distinguish browser/stereo checks from actual headset testing.
- Deliver code through Git, then pull/deploy on AWS. Heavy asset processing currently runs on macOS. Keep temporary scripts, generated assets, private manifests, and credentials out of code commits. Do not introduce extra approval gates for routine authorized work.
