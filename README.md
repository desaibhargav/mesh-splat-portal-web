# Mesh–Splat Portal Web

The browser application for discovering and viewing cultural-heritage meshes and Gaussian splats.

For ongoing development, read [project instructions](AGENTS.md), [project principles](docs/project-principles.md), and the [deferred roadmap](TODO.md).

## Intended stack

- React and TypeScript
- Vite
- React Router
- TanStack Query
- PlayCanvas and its official React integration

In production, Vite builds static HTML, CSS, and JavaScript. Nginx serves those files and exposes same-origin `/api/` and `/files/` routes that reverse-proxy to the artifact service.

## Repository boundary

This repository owns the catalog and viewer user experience. It does not own artifact storage, catalog persistence, or server-side file boundary checks.

## Current status

The React/Vite application includes browser routing, a debounced server-side catalog search, mesh/splat filters, runtime API validation, and real PlayCanvas mesh and Gaussian-splat loaders. PlayCanvas-provided controls supply orbit, pan, and zoom; splats use the current official camera-controls script and unified renderer.

Locally, Vite proxies `/api/` and `/files/` to the artifact service on port 8080. This preserves the production same-origin request shape without development CORS rules.

## Run locally

Mesh viewing uses a bundled, prefiltered studio environment for ambient illumination and reflections, with a plain background. Lighting asset provenance and preparation are documented in [`public/lighting/README.md`](public/lighting/README.md). Gaussian splats retain their captured appearance.

Start the artifact service first, then:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The portal is currently public, so no login is required. The Vite server is development-only; production uses `npm run build` and serves `dist/` through Nginx.

## Selection tools

Mesh and splat viewers share one **Select** toolbar icon. Choose **Box**, **Lasso**, or **Brush** under **Selection type** in its bottom-right options. The chosen type is remembered when switching tools. The pointer icon returns to navigation. **Q** or Escape exits the active tool. While selecting, left-drag draws the selection, Alt/Option+left-drag or right-drag orbits, middle-drag pans, and the wheel zooms. Navigation preserves the active tool and existing selection; hold Shift when drawing another region to add it. **F** frames the selection (or the whole object when nothing is selected) and sets the orbit pivot to its center, preserving the viewing direction. Ctrl/Cmd+Z undoes selection and isolation changes; Ctrl/Cmd+Shift+Z redoes them. Camera movement and tool settings are not part of selection history. Shortcuts apply while the viewer has focus and leave text inputs alone.

Selection actions appear at the bottom right while a selection tool is active. **X-ray off** selects visible surfaces; **X-ray on** selects through the object. Mesh selection renders per-triangle IDs using PlayCanvas's depth-tested picker pass, cropping its bounded pixel budget to the gesture. A lazy worker uses the established `three-mesh-bvh` queries to test GPU-unhit face centers without blocking the UI thread. The combined result respects culling, clipping, transforms, isolation, segments and mesh parts. It performs no selection work while idle and releases its worker with the viewer. This covers the dense regressions in browser tests but does not claim mathematical coverage for an arbitrarily small visible sliver. Splat visibility uses PlayCanvas's depth-picking render pass and its alpha threshold, with a pixel-sized depth tolerance. Splat selection tests Gaussian centers; X-ray mesh selection tests triangle centroids.

Shift adds, Ctrl/Cmd removes, and Shift + Ctrl/Cmd intersects. Brush diameter is adjustable. Selections update when the gesture ends. **Isolate** hides unselected geometry; **Show all** restores it while retaining the highlight. **Clear** removes the active selection and exits isolation; saved selections remain available for reopening from the saved box. Further selections while isolated act only on the remaining geometry.

**Color selection** applies either a quick swatch or any custom six-digit sRGB shade to selected triangles or splats. The custom picker comes from the small, dependency-free `react-colorful` package; changes apply only when confirmed, and its drag state remains local to the picker. Recoloring changes the active selection's own shade while preserving colors owned by earlier overlapping selections. Colors remain when switching tools, clearing the selection, or annotating another region. Remove Color removes the active selection's own color. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z include paint edits in selection history. Painted selections display their chosen color without the default highlight covering it; unpainted selections use the default highlight. Colors last until leaving the asset and do not modify source files.

Paint uses immutable packed-sRGB buffers shared across unchanged undo snapshots. Mesh groups use standard PlayCanvas materials and share one copied vertex buffer per source part; only active index subsets/materials are allocated. Splats reuse the work-buffer modifier with an RGBA paint texture uploaded only when colors change. There are no asset-specific colors or shader color literals.

The tools adapt SuperSplat's gesture and modifier conventions ([MIT notice](public/licenses/supersplat.txt)). Splats use an ID-indexed selection texture and the unified renderer's work-buffer modifier API. Static triangle meshes use index subsets grouped by selection and palette color, preserving their vertex attributes and original base materials. Skinned and morphed meshes are not supported. Isolation changes visibility, not the asset's memory footprint. A draft session can contain several gestures from different camera positions. **Save selection** consolidates all of its unsaved regions into one named record in the saved box and model tree; **Clear Selection** discards the complete draft session while retaining saved records. Reopening a saved selection restores its combined mask for editing or isolation; **Update selection** replaces that entry. Selections belong to the current viewer session; no asset bytes or catalog records are modified.

## Views

The **Views** icon opens saved views and **Create view**. Name a draft and rotate the asset against a fixed world grid using PlayCanvas's native rotation gizmo, or align it using three surface points. The native navigation widget changes only the camera; optional orthographic projection is independent of asset orientation. Saved entries restore the asset orientation, camera, framing, and orbit pivot and open for editing. Cancel/Q restores an unsaved draft's previous arrangement. Measurement and annotation anchors remain attached. Source geometry is unchanged and views remain session-local. See [saved views](docs/views.md).

## Cross sections

The **Cross section** icon enables a shared world-space clipping plane for meshes and splats. Load a saved view or use **From current camera**, choose the cutting-plane normal (View or world X/Y/Z), then adjust offset, two tilts, flip, guide visibility, and camera alignment. The reference dropdown retains the chosen name. Sectioned mesh reverse faces use neutral grey without the exterior texture; explicit region colors remain visible. Q exits the controls while retaining clipping. Removed surfaces are also excluded by surface/ID picking. This preserves source geometry; filled caps, contours, and persistent storage remain deferred. See [sectioning](docs/sectioning.md).

## Measurement

The ruler icon enables measurement for meshes and splats. Click two visible surface points to draw a solid white line with its straight-line distance. Shift-click starts an additional measurement while retaining completed lines; click again to finish it. Line-width and font-size sliders adjust all measurements. Alt/Option orbit, pan, and zoom remain available. Q/Escape exits placement mode while keeping the lines visible. **Save measurement** keeps the line visible and adds a named entry above the options and in the model tree. Click an entry to expose its two native move gizmos; dragging an endpoint snaps it onto the visible surface. Updating closes the gizmos while retaining the line. The tree eye hides/shows it, and the saved-list minus button deletes it. F frames the measurement endpoints and sets their orbit pivot. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo measurement edits; Clear measurements removes them all.

Picking uses PlayCanvas's depth-enabled `Picker.getWorldPointAsync`, at viewport resolution, with buffers reused between clicks and one depth image cached for each endpoint drag. Measurement visuals use PlayCanvas's batched `WideLineRenderer`, sphere render primitives, world-space text elements, and one shared `CanvasFont` atlas. The same scene renderer serves meshes and splats and supports stereo/XR cameras, without an SVG overlay, external font download, or new dependency. Labels face the camera and line thickness remains readable while navigating. Measurements belong to the viewer session and respect isolated geometry.

The inspected scans have no verified physical calibration, so distances remain unitless. A future calibrated asset will append its declared unit, such as mm or m. Splat picks estimate a surface from rendered Gaussians. See [measurement details](docs/measurement.md).

## Annotations

The annotation icon is the single entry point for notes. Opening it first asks the user to click a visible surface and places a preview marker. The annotation form then appears. Enter a title and note, and optionally choose **Annotate a selection** to hover and bind an existing selection without moving the marker. **Save annotation** commits the marker and optional region binding; **Cancel** discards the draft.

Numbered hotspots display notes when clicked in navigation or annotation mode. Hovering geometry in a bound selection also displays its note. A bound marker uses the selection's dominant painted shade, or the standard selection highlight when unpainted. Saved annotations have a separate list with edit, move-marker, and red delete controls; visible numbers remain consecutive after deletion. **Select annotated area** restores its independent region snapshot and focuses it, even after the current selection has changed. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo saved annotation edits while this tool is active; text fields retain ordinary text editing and Q input. Q/Escape exits the tool after leaving a text field. Alt/Option orbit, pan, and zoom remain available.

Hotspots use PlayCanvas's bundled `Annotation` and `AnnotationManager` scripts, with a small container adapter for our embedded/fullscreen viewer. Point placement shares measurement's GPU picker; annotation layers are excluded from surface/depth picking. Text renders as plain text. Region masks reuse selection history's bit packing. Notes remain in memory until leaving the asset; persistent saved views and WebXR are deferred in [TODO.md](TODO.md).

## Capture

The camera icon opens a name field and green **Download** actions. It requests one completed PlayCanvas frame and downloads the scene canvas as a PNG at its current render resolution. An optional annotated download composites every visible annotation marker, title, and description after that frame; the normal download remains a clean scene image. In four-view mode, the same canvas contains all four panels, so one PNG captures the complete split. Portal controls, viewport labels, and navigation widgets are excluded. Capture adds no idle rendering or server upload; browser-download behavior is shared by meshes and splats. Immersive-XR capture remains unverified.

## Model tree

The tab at the left center opens a shared model tree for segments, selections, measurements, annotations, views, and sections. Explicitly saved selections, measurements, annotations, views, and sections become named children. The eye control independently shows or hides its viewport overlay, line, or marker; it does not alter source geometry. Reopen records from the saved box above each tool’s options to edit, update, or delete them; clicking a tree name opens the corresponding tool and frames that record. Use its pencil button to rename it; the saved box and any open editor update together. These records and edits remain in the current viewer session and use the same state for meshes and splats.

Shared tool contracts and engine API reuse are documented in [docs/viewer-tools.md](docs/viewer-tools.md).

The remaining work is tracked in [TODO.md](TODO.md), including saved views, WebXR, calibration, selection accuracy, thumbnails, and turntable previews.

## AWS demo deployment notes

`scripts/deploy-server.sh` enables HTTPS when both `fullchain.pem` and `privkey.pem` exist in `/etc/letsencrypt/live/$SITE_NAME` (default site name: `mesh-splat-portal`). Set `CERT_DIR` for a different certificate location. Certbot owns issuance and automated renewal; its deploy hook must validate and reload Nginx after renewal (`nginx -t && systemctl reload nginx`). HTTP remains available for webroot certificate validation. The script retains the same API and streaming-file proxy routes on both ports. If no certificate exists, initial deployment remains HTTP-only.

On the frontend gateway instance, build the static portal:

```bash
npm ci
npm run build
```

Do not serve the built application directly from `/home/ubuntu/...`. Nginx runs as `www-data` and cannot normally traverse the private `ubuntu` home directory, which can cause `500 Internal Server Error` responses with `Permission denied` entries in `/var/log/nginx/error.log`.

Publish the built files into a web root that Nginx can read:

```bash
sudo mkdir -p /var/www/mesh-splat-portal
sudo rsync -a --delete dist/ /var/www/mesh-splat-portal/
sudo chown -R www-data:www-data /var/www/mesh-splat-portal
```

The Nginx site should point at that published directory:

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/mesh-splat-portal;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Validate and reload Nginx after edits:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

After the server has been configured once, future frontend deployments can be run from an SSH session on the frontend gateway:

```bash
./scripts/deploy-server.sh
```

To install or update same-origin proxy routes at the same time, provide the backend origin from the shell instead of committing it:

```bash
BACKEND_ORIGIN=http://BACKEND_PRIVATE_IP:3000 ./scripts/deploy-server.sh
```

`BACKEND_PRIVATE_IP` is the private IPv4 address of the backend EC2 instance, not its public SSH address. In the AWS console, select the backend instance and copy **Private IPv4 address**. From an SSH session on the backend instance, the same value can be obtained with:

```bash
hostname -I
```

Use the `172.x.x.x` private address that belongs to the VPC. The frontend gateway uses this address for internal AWS traffic; the browser never sees it.

Script inputs:

| Variable | Default | How to choose it |
| --- | --- | --- |
| `BACKEND_ORIGIN` | empty | Set to `http://BACKEND_PRIVATE_IP:3000` when the gateway should proxy `/api/` and `/files/` to the backend. |
| `WEB_ROOT` | `/var/www/mesh-splat-portal` | Change only if Nginx should serve the built frontend from a different directory. |
| `SITE_NAME` | `mesh-splat-portal` | Change only if this server needs a different Nginx site filename. |

The script pulls the latest `main`, installs dependencies from the lockfile, builds the Vite app, publishes `dist/` to `/var/www/mesh-splat-portal`, installs or updates the Nginx site, validates Nginx, and reloads it. It does not contain SSH keys, passwords, IP addresses, or other secrets.

If the portal loads but says the artifact service is unavailable, the static frontend is working and the next step is to configure the `/api/` and `/files/` reverse proxy routes to the backend instance.

The viewer-wide **Four views** button or **Space** over the canvas opens the shared Top/Front/Right/Perspective workspace; Space maximizes/restores the hovered panel. All tools share one asset and document across panels. Named views and **Save section** entries are available in the model tree for the current session. See [workspace details](docs/viewports.md).
