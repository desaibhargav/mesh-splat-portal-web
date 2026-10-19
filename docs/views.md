# Reference views

The shared **Views** tool defines named reference frames without transforming the mesh or splat. Frames contain an origin, quaternion orientation, viewing distance, and field of view. The origin is the orbit pivot; local X/Y span the reference plane and local +Z points toward its camera. This is also the reference needed by future sectioning. There is no scale operation: zoom records framing without changing the asset or physical calibration.

## Workflow

1. Navigate to a useful angle and open Views. **Use current view** captures the camera direction, roll, framing, and orbit pivot.
2. Choose **Move** (W) or **Rotate** (E) and drag PlayCanvas's native handles on the reference helper. Shortcuts apply while Views is active, outside text entry and three-point placement. A square guide shows the plane and a line indicates its normal. This changes the reference, not the asset or the camera.
3. **Look along reference** previews the edited frame and sets the orbit pivot to its origin. Navigation remains available outside handles, with Alt/Option to orbit over them; right-drag orbits, middle-drag pans, and the wheel zooms.
4. Enter a name and **Save view**. Click a saved name to recall it; edit its name/reference and **Update view**, or choose **New view**. The minus button deletes a view. Q/Escape removes the helper and returns to navigation.

Views currently belong to this asset's viewer session and disappear on leaving or refreshing. They do not capture selections, measurements, annotations, or colors. IndexedDB/export of the complete working document remains separate deferred work. World X/Y/Z alignment and three-point surface alignment are implemented for both asset formats. Use **Align to three points**, then pick an origin, X direction, and a third point defining the plane; Q or Cancel aborts placement. Saved references can be copied into [Cross section](sectioning.md). Face alignment is intentionally omitted because splats have no triangle faces.

## Engine reuse and cost

`TranslateGizmo` and `RotateGizmo` own handle geometry, picking, and transforms; only a reference `Entity` is attached. The active tool owns one native gizmo layer. Five guide segments are drawn with `AppBase.drawLines`, using ten reused vectors. Size derives from viewing distance and FOV. No model traversal, mask upload, CPU model ray casting, asset copying, or extra camera is needed. No view-helper resources or render callbacks remain when the tool is closed.

The bundled `CameraControls` script in PlayCanvas 2.21.4 exposes reset/focus functions that use `Pose.look`, which drops roll. Our small subclass adds `restorePose`: it synchronizes the engine's own `Pose`, active `InputController`, camera entity, and focus distance at recall time. Two protected script fields are declared at this pinned-version boundary; review it on upgrades and replace it if upstream exposes full-pose restoration. It adds no per-frame work or replacement navigation logic. The class declares its PlayCanvas script name explicitly, so minification cannot change its registration or break existing tools. The production-only Views crash was caused by relying on the subclass name; critical interactions must be tested on minified output as well as the development server.

The camera script is paused only for native gizmo drags, and its previous enabled state is restored at transform end, pointer cancellation, tool exit, or viewer teardown. Input sources remain attached and discard deltas through the script's existing state handler. Alt/Option and the secondary mouse buttons remain navigation inputs. Both normal React cleanup and application destruction dispose of the helper before the graphics device disappears.

## Verification

Browser interaction checks on `21e231-006699` (mesh) and `sakura-garden` (splat) exercised native move/rotate drags, unchanged asset transforms, preview with roll and orbit pivot, save/recall/update/delete, Q, continued rendered navigation, mobile panel bounds, and navigation away without browser errors. Automated math tests exercise a translated/rolled reference through the actual `OrbitController` and verify that editing a draft cannot mutate a saved frame. Follow [browser verification](browser-verification.md) when changing this tool; local fixture paths remain outside the repository. This does not establish Safari or headset compatibility.
