# Immersive viewing and controller manipulation

Open an artifact on the HTTPS portal in Quest Browser. When the device reports support, **View in VR** and **View in your room** icons appear at the bottom of the viewer. VR uses an immersive virtual background; AR uses transparent rendering for headset passthrough. Accept the browser's session permission. Move your head or walk around to inspect the artifact. **Press B on the right controller to exit** back to the portal. The left controller's system Menu button can also leave the WebXR session; the page offers an exit icon when accessible.

In AR, point a controller at a detected floor or tabletop. A green target shows the placement point; press the trigger to place the artifact there. The artifact stays hidden until placed. In both AR and VR, hold the left trigger and move the controller to orbit the artifact, or hold the right trigger and point/move/tilt to pan it. Push the left thumbstick forward to zoom in and backward to zoom out. Hold a controller's side grip button to pick up and reposition the artifact; release it to leave it in place. Two grips move and turn it. PlayCanvas's `XrControllers` loads tracked controller models and the viewer draws pointing rays. PlayCanvas's `XrManipulation` owns the two-grip transform; zoom is controlled by the thumbstick. Hand tracking and selection, measurement, annotation, section editing, and desktop HTML menus do not yet have immersive controls. The staged path to these controls is [XR tool integration](xr-tooling.md).

If a circle appears around your feet and the virtual scene fades as you approach it, that is Quest's Stationary boundary. The portal does not draw or control it. For physical walking around an artifact, use a Roomscale boundary in a clear area. The XR browser regression also moves the simulated headset close to both asset formats and verifies that each remains rendered; real boundary behavior requires a Quest test. [Meta boundary guidance](https://developers.meta.com/vr/design/head/).

## Engine boundary

Both formats use one `ImmersiveViewer`, the installed PlayCanvas `XrManager`, `immersive-vr` / `immersive-ar`, and `local-floor`. The official React application's WebGL context is explicitly XR-compatible. Support is capability-gated; desktop browsers without an available immersive device retain the ordinary toolbar. Rejected session requests restore the desktop and expose the error for retry.

In VR, the first tracked head pose places the asset's bounding-box centre 1.5 metres ahead at eye height. In AR, native WebXR hit tests locate a horizontal real surface under the controller ray and placement rests the displayed bounds on the chosen point. The largest asset dimension initially displays as one metre. These are presentation defaults, **not physical calibration**. One presentation parent moves the artifact; camera tracking and controller models remain in metres. Source geometry, saved coordinates, orientation, colors, and segment masks are unchanged. Existing section planes follow the artifact during manipulation. Subsequent head movement never repositions the asset. Placement is not retained between sessions.

Only the Perspective camera renders in XR. Leaving restores its parent, pose, projection, clip planes, background, render settings, canvas resolution, and prior single/four-view arrangement. The existing desktop camera controller yields to WebXR and resumes on exit. Controller gestures use PlayCanvas XR input sources, rays, planes, and transforms. AR placement requests a persistent hit test against each controller's native WebXR `targetRaySpace`: PlayCanvas's input helper currently requests transient hit tests, which do not provide a continuous placement target. Hit tests and the single reticle stop after placement. The native model loader obtains WebXR Input Profiles assets from a version-pinned CDN; model loading currently needs a network connection, while tracked poses and grip manipulation use the browser's XR input directly. No input-profile package is bundled into the portal.

## Verification

The test uses Meta's official [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) **only in the browser harness**, never in the application bundle. Install it outside the repository:

```bash
npm install --prefix /private/tmp/gab-xr-test iwer@2.7.0 @iwer/sem@2.7.0 --no-audit --no-fund
```

With the dev server running on 5175:

```bash
XR_EMULATOR_PATH=/private/tmp/gab-xr-test/node_modules/iwer/build/iwer.js XR_SEM_PATH=/private/tmp/gab-xr-test/node_modules/@iwer/sem/build/iwer-sem.js npm run test:browser:xr
```

Repeat after `npm run build` and starting the production preview on 5180:

```bash
VIEWER_BASE=http://127.0.0.1:5180 XR_EMULATOR_PATH=/private/tmp/gab-xr-test/node_modules/iwer/build/iwer.js XR_SEM_PATH=/private/tmp/gab-xr-test/node_modules/@iwer/sem/build/iwer-sem.js npm run test:browser:xr
```

The suite uses published mesh/splat derivatives and real PlayCanvas sessions with two emulated eyes and a synthetic floor. It checks denied entry/retry, VR placement, AR floor targeting and trigger placement, stereo output, tracked head and controllers, controller model loading, grip movement, orbit, pan, thumbstick zoom, right-B exit, grip transitions, disconnect, AR alpha, section-plane composition, text-entry → XR → desktop rendering recovery, and complete desktop camera/layout restoration. Screenshots go to an OS temporary directory. Repeat capture and segment composition regressions after camera/lifecycle changes.

Emulation does not establish Quest performance, real passthrough composition, comfort, hand tracking, browser permission behavior, or physical tracking. These require a real Quest 3 check after deployment. Headset validation is still pending.

References: [PlayCanvas WebXR](https://developer.playcanvas.com/user-manual/xr/using-webxr/) and [Meta Browser passthrough](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/).
