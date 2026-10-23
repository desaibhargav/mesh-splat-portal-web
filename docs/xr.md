# Immersive viewing and controller manipulation

Open an artifact on the HTTPS portal in Quest Browser. When the device reports support, **Enter VR** and **View in your room** appear in the viewer's top bar. VR uses an immersive virtual background; AR uses transparent rendering for headset passthrough. Accept the browser's session permission. Move your head or walk around to inspect the artifact; leave through the headset's browser/system session controls. The page also offers **Exit immersive view** when accessible.

PlayCanvas's `XrControllers` loads tracked controller models and the viewer draws pointing rays. Hold one controller's grip to move and tilt the artifact in all directions. Hold both grips to move, turn, and resize it; release them to leave it in place. PlayCanvas's `XrManipulation` owns the two-grip transform. The single-grip adapter uses the tracked controller pose and the same artifact parent. Hand models and two-hand fist input are supported by the native scripts, but hand tracking has not yet been verified on Quest. The rays are visual only. Selection, measurement, annotation, section edits, and desktop HTML tool menus do not yet have immersive input or world-space controls.

## Engine boundary

Both formats use one `ImmersiveViewer`, the installed PlayCanvas `XrManager`, `immersive-vr` / `immersive-ar`, and `local-floor`. The official React application's WebGL context is explicitly XR-compatible. Support is capability-gated; desktop browsers without an available immersive device retain the ordinary toolbar. Rejected session requests restore the desktop and expose the error for retry.

The first tracked head pose establishes placement once: the asset's bounding-box centre appears 1.5 metres horizontally ahead at eye height, with its largest dimension displayed as one metre. These are centralized presentation defaults, **not physical calibration**. One presentation parent moves the artifact; camera tracking and controller models remain in metres. Source geometry, saved coordinates, orientation, colors, and segment masks are unchanged. Existing section planes follow the artifact during manipulation. Subsequent head movement never repositions the asset. Placement does not snap to a table/floor and is not retained between sessions.

Only the Perspective camera renders in XR. Leaving restores its parent, pose, projection, clip planes, background, render settings, canvas resolution, and prior single/four-view arrangement. The existing desktop camera controller yields to WebXR and resumes on exit. Controller input uses PlayCanvas XR input sources. The native model loader obtains WebXR Input Profiles assets from a version-pinned CDN; model loading currently needs a network connection, while tracked poses and grip manipulation use the browser's XR input directly. No input-profile package is bundled into the portal.

## Verification

The test uses Meta's official [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) **only in the browser harness**, never in the application bundle. Install it outside the repository:

```bash
npm install --prefix /private/tmp/gab-xr-test iwer@2.7.0 --no-audit --no-fund
```

With the dev server running on 5175:

```bash
XR_EMULATOR_PATH=/private/tmp/gab-xr-test/node_modules/iwer/build/iwer.js npm run test:browser:xr
```

Repeat after `npm run build` and starting the production preview on 5180:

```bash
VIEWER_BASE=http://127.0.0.1:5180 XR_EMULATOR_PATH=/private/tmp/gab-xr-test/node_modules/iwer/build/iwer.js npm run test:browser:xr
```

The suite uses published mesh/splat derivatives and real PlayCanvas sessions with two emulated eyes. It checks denied entry/retry, initial placement, stereo output, tracked head and controllers, controller model loading, one-grip move/tilt, two-grip move/turn/resize, grip transitions, disconnect, AR alpha, section-plane composition, text-entry → XR → desktop rendering recovery, and complete desktop camera/layout restoration. Screenshots go to an OS temporary directory. Repeat capture and segment composition regressions after camera/lifecycle changes.

Emulation does not establish Quest performance, real passthrough composition, comfort, hand tracking, browser permission behavior, or physical tracking. These require a real Quest 3 check after deployment. Headset validation is still pending.

References: [PlayCanvas WebXR](https://developer.playcanvas.com/user-manual/xr/using-webxr/) and [Meta Browser passthrough](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/).
