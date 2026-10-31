# Splat performance investigation

The reported Quest 3 problem affects the ordinary splat webpage and immersive AR/VR, including controller responsiveness outside the page. Meshes do not reproduce it. This report separates measured application work from the unresolved headset bottleneck. Full published splat detail is retained.

## Measured workloads

The necklace `2022-01-0056-model` contains 1,500,020 Gaussians with three spherical-harmonic bands. The portal now uses PlayCanvas 2.23.3, unified splat rendering, WebGL 2, and native worker sorting. Multisample antialiasing is disabled for splats. The fixed-SOG baseline below predates the native Streamed SOG restoration described at the end of this report. The initial comparison below used 2.21.4 before the resource/lifecycle corrections described next.

## Confirmed application and integration faults

Opening a pristine splat previously installed the custom shader extensions, enabled source IDs and allocated four whole-cloud edit textures before any editing operation. `SplatSelection` now leaves the native rendering path intact until selection display, paint, scope, sectioning, or ID picking actually needs the extensions. Initializing a section must not reset its already-active plane. The textures are created once and retained after editing so saved edits keep rendering; this is deferred allocation, not a claim that editing requires no additional memory.

In the controlled Chromium regression, engine-tracked GPU texture allocations were 40,050,996 bytes with the native path and 105,823,572 bytes after enabling editing: about 63 MiB of avoidable initial allocation for the same 1,500,020 Gaussians. These are engine counters, not browser-driver memory, CPU memory, or Quest measurements. A raw GL audit also found zero graphics calls during settled desktop Navigate and no eagerly created surface-query worker.

Rapid XR exit/re-entry reproduced an uncaught `instantiateRenderEntity` error in the old native controller loader. A model could be unloaded while another load was waiting for it. The portal now uses the upstream controller ownership fixes in PlayCanvas 2.23.3, with one native controller-model cache owner per viewer application, created only on first XR entry. Ending a session removes its controller instances; closing the viewer releases the cached model resources. A deterministic regression delays model downloads through session exit/re-entry, requires both controllers in the next session and exactly one download per model URL, and rejects browser errors.

The newer native end event keeps its session/camera available to listeners until end processing completes. Desktop camera clip planes and viewport navigation are restored in the next microtask, after the engine detaches XR listeners. Disposing the viewer instead releases session resources immediately without trying to restore a camera that is being destroyed. This ordering is necessary to avoid updating the render state of an already-ended session; it is not a rendering delay or navigation reset.

The desktop pixel-ratio cap also fed the engine's XR framebuffer scale calculation. With a display pixel ratio of 3 and the default canvas cap of 1, the old setup requested one-third linear resolution. `ImmersiveViewer` now compensates through the native `framebufferScaleFactor` option, requesting the runtime's normal resolution independently of the desktop canvas. The high-DPI regression checks the actual layer-constructor option because IWER does not model its resolution effect. This corrects a conditional resolution fault; it does not prove the Quest used that pixel ratio or that higher resolution reduces frame cost.

These faults are independently verified. They do not establish the complete cause of the reported headset-wide lag or white dots. Keep full detail and verify the deployed behavior on Quest before calling that report resolved.

Controlled Chromium measurements on the Mac, at a 1102 × 544 framebuffer:

| Configuration | Scene draws per frame | GPU frame time, approximate | Engine-tracked GPU allocations |
| --- | ---: | ---: | ---: |
| Portal splat shaders and resident selection textures | 1 | 4–6 ms | 101 MiB |
| Native unified renderer, portal shader extensions disabled | 1 | 5–6 ms | 101 MiB, with portal textures still resident |
| Native legacy renderer | 1 | 7–8 ms | 54 MiB |

These comparisons do not identify a large steady shader overhead on this Mac. They do not establish the same result on Quest. Native legacy rendering was not adopted: it was slower here and does not provide the current unified tool contracts.

A Gaussian is submitted as a billboard with four corners. At this count the raster path submits about six million corners per view, before fragment processing; stereo roughly doubles that work. The vertex shader projects Gaussian footprints, and overlapping translucent fragments require blending. One draw call therefore does not mean a cheap frame. GPU timer queries in the local resolution experiment rose modestly when framebuffer size increased ninefold; pixel fill alone did not explain the Mac's cost. Quest may have a different limiting resource.

## Avoidable sorting work

The engine's default directional sorter treats a change in camera direction as a reason to sort the complete splat again. In an IWER rotation-only replay, 90 tracked frames produced 87 worker sorts. Individual local worker sorts took roughly 8–15 ms. With native `scene.gsplat.radialSorting`, that same rotation replay produced zero repeated sorts. Adding a small translating head motion produced 86 versus 16 sorts over the same 90-frame sequence.

`ImmersiveViewer` now enables native radial sorting for splat XR sessions and restores the previous setting on exit. Translation and artifact changes still sort. This changes ordering policy, not Gaussian count or framebuffer resolution. PlayCanvas documents a visual tradeoff: radial sorting favors camera rotation, while directional sorting can minimize artifacts during translation. Stereo output and tool workflows are browser-tested; actual Quest motion and transparency artifacts remain to be checked.

The regression checks that head rotation does not repeatedly sort, a translation still refreshes sorting, and session exit restores desktop behavior. Selection, paint, annotation, marker dragging, ray clipping and navigation are exercised with that setting in VR and AR.

## Idle work and resource ownership

Before the passive-rendering change, the page issued 60 scene draws across 60 idle update ticks. `ViewerRenderPolicy` now uses the native render-on-demand events for passive Navigate. A raw WebGL-call audit found only final startup draws and one pending sort, followed by zero draws or sorts while settled, including pointer hover. The splat surface BVH worker was not created before using a surface tool. Active tools and XR still render continuously.

Three live page/open → catalog cycles released the renderer's context reference, stopped application updates, and terminated the native sort worker. Engine-tracked residual allocations were constant at about 36 KiB after teardown rather than accumulating. This does not measure browser-driver memory or prove the absence of a Quest-specific resource issue.

Quest access logs confirm that the headset fetched the passive-rendering build. Stale code is not an established explanation for its remaining lag. HTML now explicitly revalidates after deployments, and renderer/debug labels are absent.

## What remains unresolved

### Interaction comparison

The latest Quest report distinguishes smooth ordinary page scrolling from lag when interacting with the viewer. That is consistent with passive Navigate stopping graphics work and camera movement resuming it; it does not establish that controller input itself is expensive. Pure pointer hover must be tested separately from a drag and from an active surface tool.

A controlled 120-frame replay of the full 1,500,020-Gaussian necklace on this Mac, with native GPU timer queries and raw WebGL call counts, found:

| Interaction | Native full work-buffer rebuilds | Native sort requests | Mean GPU frame time |
| --- | ---: | ---: | ---: |
| Desktop idle or unpressed pointer hover | 0 | 0 | No graphics calls |
| Desktop orbit | 0; 3 color-only updates | 100 | 4.7 ms |
| XR stationary head/controllers | 0 | 0 | 6.1 ms |
| XR moving controller ray only | 0 | 0 | 6.3 ms |
| XR left-trigger artifact orbit | 119 | 119 | 7.4 ms |
| XR ray movement, surface queries disabled for comparison | 0 | 0, excluding one pending sort | 6.6 ms |
| XR orbit, surface queries disabled for comparison | 119 | 119 | 7.6 ms |

Desktop used a 1102 × 544 framebuffer; IWER stereo used a 1200 × 1000 framebuffer. Instrumentation was temporary and is not shipped. The query-disabled runs did not show a local performance gain. Ordinary desktop hover did not create a surface-query worker. XR ray queries completed asynchronously, about 35 queries over the ray-only replay (mean 2.6 ms end-to-end latency, not main-thread execution time). Native worker sorts during orbit averaged about 9.5 ms. These are local measurements, not Quest timings or an assertion that the headset has the same bottleneck.

The rebuild distinction comes from the native unified renderer: desktop orbit changes the camera, while XR manipulation changes the artifact transform. Native `GSplatWorld.applyWorkBufferUpdates()` copies the changed Gaussian geometry into its world-space work buffer and requests sorting. Stationary rendering and ray movement reuse that buffer. No duplicate whole-cloud render path was found in these replays. Replacing artifact motion with inverse headset/controller transforms would change physical-space and editing contracts; do not introduce that as an untested optimization.

### Published Quest guidance and jagged edges

PlayCanvas's [performance guide](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/performance/) recommends roughly one million active Gaussians for mobile as a starting budget, not a hard Quest limit. Fixed SOG assets render in full: setting a streaming budget would not reduce this asset's workload. Their [SuperSplat Quest report](https://forum.playcanvas.com/t/supersplat-update-follow-creators-a-new-home-page-and-enhanced-xr-mode/42734) describes a 72 Hz target, fixed foveation and a one-million-splat budget, with one large scene improving from 9.7 to 30.7 fps (40.3 in Performance mode). Their [quality implementation](https://github.com/playcanvas/supersplat-viewer/blob/main/src/quality.ts) explicitly distinguishes standalone XR budgets from desktop budgets. Native APIs therefore do not imply unrestricted Quest performance. Those quality/budget reductions have not been applied here; full published detail remains required.

In our installed engine, `WebglXrBridge.attachPresentation()` constructs `XRWebGLLayer` with `antialias: false`. The splat desktop canvas also disables multisample antialiasing, consistent with the engine's fragment-cost guidance. Spatial menu textures already use double-density canvases, mipmaps and trilinear filtering. Their texture filtering cannot provide multisample coverage for the panel geometry's outer edges. These facts identify antialiasing boundaries to investigate; they do not prove the reported headset-wide zigzag artifacts have that cause. Enabling multisampling for the entire splat frame would increase rendering cost and must not be presented as a free correction. Runtime/compositor frame drops and actual layer dimensions need measurement on Quest.

The exact CPU/GPU/framebuffer bottleneck on the physical Quest is not yet measured because USB profiling is unavailable. Do not report the complete issue as fixed or attribute the white dots to hardware damage.

The former WebGPU trial is removed. It fell back to WebGL on the tested Quest; local WebGPU checks also exposed a blank-render problem in the custom shader interface. Enabling WebGPU requires proper hybrid-renderer integration and browser/XR tool tests, not only API detection.

When the Quest can be attached, inspect the actual current tab and record: update and raw GPU draw counts while stationary, camera/projection changes, canvas/framebuffer dimensions, worker sort frequency/time, GPU timer results when supported, memory, and work-buffer uploads during asset manipulation. Compare the same asset with native rendering under the same device conditions. No reduced detail, resolution, or added renderer UI is part of this investigation.

## Close inspection

XR zoom previously clamped presentation scale to ¼×–4× the initial placement; that was portal policy, not a PlayCanvas requirement. The clamp is removed. Finite positive scale is required, and scaling still preserves the VR center or the placed AR floor contact. Reset restores the placed scale. Desktop native orbit controls now use the camera near-clip distance as their positive minimum, replacing the asset-radius-based stop, and have no arbitrary far-distance cap. Camera clipping still exists; zoom does not add source detail. Enlarging Gaussian footprints can increase overdraw, and XR scale changes invoke the native transform-update path above.

The browser regression uses actual wheel input to pass the former desktop close-inspection stop and holds the controller thumbstick past the former 4× XR limit on both formats, in VR and AR. The unit regression checks AR floor preservation and Reset after 16× zoom, and rejects nonfinite/nonpositive factors.

Sources: [PlayCanvas renderers](https://developer.playcanvas.com/user-manual/gaussian-splatting/rendering-architecture/renderers/), [radial sorting API](https://api.playcanvas.com/engine/classes/GSplatParams.html#radialsorting), [Meta browser debugging](https://developers.meta.com/vr/documentation/web/browser-remote-debugging/).

## Native streamed SOG restoration

Splats now have three independently decimated native levels: 30%, 15% and 7.5% of the validated master. The finest public detail ceiling is unchanged. SplatTransform builds the spatial tree and SOG chunks; PlayCanvas owns loading, per-region LOD, worker sorting, caches and drawing. Native budget-limit mode lets distant assets use less than the global budget instead of filling it unnecessarily. Distance thresholds track asset bounds, and XR disables behind-camera LOD penalties so turning around does not expose artificially degraded regions. Mesh LOD remains disabled. No foveation or framebuffer-resolution reduction is introduced.

Native rendering can start while the canonical edit data loads. Mapping uses SciPy cKDTree offline; no nearest-neighbour search runs on the UI thread during navigation. Masks and paint remain in the finest published document; coarse geometry samples those records. Boundaries are approximate at coarse levels, and measurements remain source-space anchors. The viewer retains the existing lazy edit textures. First-use picking waits for the native completed frame and postrender, rather than reading a new ID target before it is populated.

The bridge packs canonical and picking IDs into one RG32U resource stream and one RG32U work-buffer attachment. Its custom picking shader uses that stream directly, avoiding a redundant native component-ID attachment. The native compact work buffer plus this stream uses four color attachments, the portable WebGL2 minimum. Review this pinned shader adapter on engine upgrades. Pending native-ready waits and streamed metadata requests are cancelled when their owner closes.

The streamed composition test also exposed a saved-view framing fault: a perspective camera's unused orthoHeight=10 was applied to every orthographic panel. Restoring a perspective view now derives each orthographic span from the saved distance and field of view, while saved orthographic views retain their explicit height. This is covered by a unit test and view → section → measurement in four panels.

Generation, local browser frame times and emulated stereo/session tests do not establish the improvement on the physical Quest. Record the actual headset result after deployment before calling the lag or zigzag artifact resolved.

## Spatial panel edge coverage

After streaming was deployed, the owner reported much smoother splat interaction on Quest, with the toolbar artifact remaining. A browser reproduction found opaque pixels touching every geometric edge of both the panel quad and its raised hover quad. Mipmaps filter inside the texture but cannot smooth a silhouette clipped by the quad itself. At an oblique angle the rendered borders had visible single-sample steps.

`SpatialPanel` now uses native Canvas `destination-in` compositing to leave a two-texel transparent margin and rounded, antialiased coverage inside each existing texture, including raised controls. The engine's existing trilinear filter can then smooth that visible boundary. This adds one small Canvas mask only when panel contents change; it adds no textures, geometry, render passes, or per-frame work and does not change scene resolution or global antialiasing. Input bounds and panel positioning remain the native element bounds. The browser regression checks transparent margins, partial coverage, opaque contents and rendered oblique panels in VR and AR on meshes and splats. This fixes the reproduced hard panel silhouette; confirmation of the owner's remaining Quest artifact still requires headset testing.
