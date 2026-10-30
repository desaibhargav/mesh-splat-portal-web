# Splat performance investigation

The reported Quest 3 problem affects the ordinary splat webpage and immersive AR/VR, including controller responsiveness outside the page. Meshes do not reproduce it. This report separates measured application work from the unresolved headset bottleneck. Full published splat detail is retained.

## Measured workloads

The necklace `2022-01-0056-model` contains 1,500,020 Gaussians with three spherical-harmonic bands. The portal now uses PlayCanvas 2.23.3, unified splat rendering, WebGL 2, and native worker sorting. Multisample antialiasing is disabled for splats. No LOD or lower-density XR derivative is active. The initial comparison below used 2.21.4 before the resource/lifecycle corrections described next.

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

The exact CPU/GPU/framebuffer bottleneck on the physical Quest is not yet measured because USB profiling is unavailable. Local zero-idle-draw results do not explain continuing headset lag on a stationary page. Do not report the complete issue as fixed or attribute the white dots to hardware damage.

The former WebGPU trial is removed. It fell back to WebGL on the tested Quest; local WebGPU checks also exposed a blank-render problem in the custom shader interface. Enabling WebGPU requires proper hybrid-renderer integration and browser/XR tool tests, not only API detection.

When the Quest can be attached, inspect the actual current tab and record: update and raw GPU draw counts while stationary, camera/projection changes, canvas/framebuffer dimensions, worker sort frequency/time, GPU timer results when supported, memory, and work-buffer uploads during asset manipulation. Compare the same asset with native rendering under the same device conditions. No reduced detail, resolution, or added renderer UI is part of this investigation.

Sources: [PlayCanvas renderers](https://developer.playcanvas.com/user-manual/gaussian-splatting/rendering-architecture/renderers/), [radial sorting API](https://api.playcanvas.com/engine/classes/GSplatParams.html#radialsorting), [Meta browser debugging](https://developers.meta.com/vr/documentation/web/browser-remote-debugging/).
