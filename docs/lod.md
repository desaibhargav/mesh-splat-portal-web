# Zoom-driven LOD

The pipeline publishes three independently reduced levels: **70%, 50%, 30%** of the
master's primitive count. Each starts from the validated master, with temporary PLY
recovery applied once when needed. Masters are never viewer inputs. One thumbnail
per asset remains sufficient. Existing derivatives without `lodUrl` continue using
the original single-level viewer.

## Rendering and shared editing

Splats use PlayCanvas 2.21.4 native streamed SOG: spatial chunks, loading, regional
LOD choice, sorting, budgets and drawing remain in the engine. These are discrete
precomputed levels, not Nanite or continuous simplification. `lodBaseDistance`
scales with asset bounds. The public `scene.gsplat.lodUpdateDistance` setting also
scales with bounds: its default of one world unit otherwise prevents small scans
from updating detail during short zoom movements. Normal orthographic navigation
changes both camera distance and orthographic height through our existing camera
controller; changing height independently is not a native splat LOD guarantee.

Mesh selection uses the small attributed adaptation of Three.js **r180**
`src/objects/LOD.js` (`addLevel` and `update`). Sorting, visibility decisions and
hysteresis retain the upstream logic. PlayCanvas supplies assets, camera/frustum
operations, mesh instances and rendering; Three.js is not bundled. The adaptation
accepts a bounds-normalized perspective/orthographic distance and keeps independent
state per viewport. A missing level loads asynchronously while the nearest ready
level remains visible. Downloads use `AbortController`; the engine receives its
documented `Asset.file.contents` input only while the viewer is alive and still
decodes the GLB itself. At most the three published levels are cached. License:
[`public/licenses/threejs.txt`](../public/licenses/threejs.txt), also shipped at
`/licenses/threejs.txt`. Mesh transitions use hysteresis, not geometry morphing or
an extra crossfade render pass.

Selections, paint and annotation region bindings keep stable IDs in the **finest
published derivative**, never in the master. Native PlayCanvas and glTF Transform
readers decode published centres offline; SciPy `cKDTree` builds approximate
nearest-centre correspondences. The browser loads gzip-compressed centres/maps
once and derives the finest identity map locally. No spatial search runs during
navigation. A coarse display projects the same document; returning to fine detail
does not overwrite saved fine boundaries. A coarse edit expands through its
correspondence into that shared document. Different topology, close disconnected
surfaces and thin geometry can produce approximate region boundaries. This is not
an exact topology correspondence algorithm.

The same controls, document, undo history, saved items, scene visibility, asset
orientation, section plane, measurements and annotations operate in every level
and viewport. Surface picking targets the displayed geometry and clipping state.
Measured points remain model-space anchors; changing displayed detail does not
recompute or recalibrate their distance. Geometry-dependent count readouts refer
to the canonical published document, rather than the current draw count.

## Costs and ownership

The mesh bridge performs bounded camera decisions per visible viewport per frame.
Mask/paint projections run after edits or first loading a level, not every frame.
Mesh overlays borrow original vertex buffers; they own only subset index buffers.
Splat ID work uses two resource streams and one work-buffer stream (three uint32
values per corresponding splat allocation), connecting native chunk IDs to shared
editing data. The pinned engine's SOG resource stream format is synchronized once
on chunk load before filling those streams; review `StreamedSplatBridge` on engine
upgrades. Region picking reads only the selected screen rectangle.

LOD is not free: correspondence adds startup transfer/CPU memory; caching levels
adds GPU memory, and four views render four cameras. Embedded GLB textures can be
resident separately in each loaded level. Native splats retain their own cache and
per-camera work buffers. Gzip reduced correspondence on the sample skull from
about 5.5 MB to 1.5 MB and Sakura from 6.5 MB to 1.9 MB. The compatibility flat SOG
also consumes disk/server storage but is not fetched by the new viewer.

Local Chromium measurements with saved paint and annotations showed about
16.7 ms median animation-frame intervals in single and four views for the skull
and Sakura. Approximate engine-reported allocated GPU memory was 67–108 MB for the
mesh through the session and 23–43 MB for Sakura. Coarse drawing reduces primitive
work, but retained caches can increase allocated memory after zooming. These are
local headless measurements, not a baseline-controlled speedup claim or a mobile,
Safari, WebGPU or headset performance guarantee. The larger 1.24-million-splat
finest chess derivative also passed these workflows: roughly 132 MB GPU allocation
in the fine single view and 292 MB in four views, with about 16.7 ms median frame
intervals on this machine. That run fetched about 53 MB by first fine readiness
and 128 MB across zooming, panel maximize/restore, editing and sectioning. Native
resource release can cause later refetches; this is not a claim of minimum transfer. Cold loading and shader compilation
can stall; do not infer frame latency from steady-state averages alone.

## Verification and deployment

Run unit tests/builds in both repositories, then the persistent real-pointer suite:

```bash
# Backend: generate local derivatives and build its publication validator.
npm run process:derivatives
npm run build

# Frontend, with Vite or production preview already running:
node scripts/test-lod-browser.mjs
VIEWER_BASE=http://127.0.0.1:5183 node scripts/test-lod-browser.mjs
```

The browser suite resolves Puppeteer from the sibling processing package and serves
only the production validator's explicit derivative file graph. It checks all
three LODs, visible selection → paint → bound annotation, immutable saved masks
across zoom transitions, four-view navigation, saved view → section → measurement,
rendered screenshots, errors, teardown and a deliberately delayed fine-mesh
response released after navigating away. Viewer cleanup is idempotent because
application destruction and React effect cleanup can both request it. `LOD_ASSET_ROOT`, `LOD_MESH_SLUG`,
`LOD_SPLAT_SLUG`, and `LOD_TEST_OUTPUT` select other local fixtures and output paths.
See [browser verification](browser-verification.md) for the wider saved-edit,
measurement-gizmo and undo/redo workflow checks. Read screenshots as well as state
assertions. Temporary output belongs outside the repository.

Desktop multi-camera coverage does not establish immersive compatibility. Native
scene rendering and the shared viewport contracts are retained, with no separate
XR editor. Actual XR sessions, mobile GPU stream/MRT limits, controller picking,
immersive tool panels and headset memory/performance remain unverified or deferred
under [TODO](../TODO.md).

Deploy both frontend and backend code before publishing/transferring LOD bundles.
The backend must authorize nested SOG files and send gzip correspondence with
`Content-Encoding: gzip`. Existing catalog IDs/content paths remain unchanged;
refresh bundle sizes through catalog synchronization. Do not transfer master files
or private processing manifests with public derivatives. Generating files locally
is not an AWS deployment. The backend README records the open Linux processing
migration and security gaps.
