# Mesh–Splat Portal Web

The browser application for discovering and viewing cultural-heritage meshes and Gaussian splats.

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

Mesh and splat viewers offer rectangle, lasso, and brush selection. The pointer icon returns to navigation. **Q** or Escape exits the active tool. While selecting, left-drag draws the selection, Alt/Option+left-drag or right-drag orbits, middle-drag pans, and the wheel zooms. Navigation preserves the active tool and existing selection; hold Shift when drawing another region to add it. **F** frames the selection (or the whole object when nothing is selected) and sets the orbit pivot to its center, preserving the viewing direction. Ctrl/Cmd+Z undoes selection and isolation changes; Ctrl/Cmd+Shift+Z redoes them. Camera movement and tool settings are not part of selection history. Shortcuts apply while the viewer has focus and leave text inputs alone.

Selection actions appear at the bottom right while a selection tool is active. **X-ray off** selects visible surfaces; **X-ray on** selects through the object. Mesh selection renders per-triangle IDs using PlayCanvas's picker render pass, with depth testing and a dedicated layer. It selects any face with a covered pixel inside the gesture, respecting face culling, clipping, transforms, and isolation across mesh parts. The ID geometry and full device-resolution pick buffer are reused; only the gesture's bounding rectangle is read back asynchronously. There is no CPU ray casting. As with raster picking generally, triangles that cover no sample at the current zoom can be missed; zooming in improves coverage. Splat visibility uses PlayCanvas's depth-picking render pass and its alpha threshold, with a pixel-sized depth tolerance. Splat selection tests Gaussian centers; X-ray mesh selection tests triangle centroids.

Shift adds, Ctrl/Cmd removes, and Shift + Ctrl/Cmd intersects. Brush diameter is adjustable. Selections update when the gesture ends. **Isolate** hides unselected geometry; **Show all** restores it while retaining the highlight. **Clear** removes the selection and exits isolation. Further selections while isolated act only on the remaining geometry.

**Color selection** applies a palette tint to selected triangles or splats. Colors remain when switching tools, clearing the selection, or annotating another region. The reset swatch restores original colors only within the current selection. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z include paint edits in selection history. Painted selections highlight in their chosen color; unpainted selections use the default highlight. Colors last until leaving the asset and do not modify source files.

Paint uses immutable, one-byte palette-index buffers shared across unchanged undo snapshots. Mesh groups use standard PlayCanvas materials and share one copied vertex buffer per source part; only active index subsets/materials are allocated. Splats reuse the work-buffer modifier with a palette texture and a paint-index texture, uploaded only when colors change. Palette entries live in `selectionColors.ts`; there are no asset-specific colors or shader color literals.

The tools adapt SuperSplat's gesture and modifier conventions ([MIT notice](public/licenses/supersplat.txt)). Splats use an ID-indexed selection texture and the unified renderer's work-buffer modifier API. Static triangle meshes use index subsets grouped by selection and palette color, preserving their vertex attributes and original base materials. Skinned and morphed meshes are not supported. Isolation changes visibility, not the asset's memory footprint. Selections belong to the current viewer session; no asset bytes or catalog records are modified.

## Measurement

The ruler icon enables measurement for meshes and splats. Click two visible surface points to draw a line with its straight-line distance overlaid in model units. Shift-click starts an additional measurement while retaining completed lines; click again to finish it. Alt/Option orbit, pan, and zoom remain available. Q/Escape exits placement mode while keeping the lines visible. Returning to the ruler allows more measurements or clearing them. F frames the measurement endpoints and sets their orbit pivot. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo measurement edits; Clear measurements removes them all.

Picking uses PlayCanvas's depth-enabled `Picker.getWorldPointAsync`, at canvas resolution, with buffers reused between clicks. Markers and labels use lightweight SVG overlays projected through the PlayCanvas camera. They follow navigation without introducing a text/font asset or UI dependency. Measurements belong to the viewer session and respect isolated geometry.

GLB uses meters by specification, but the inspected scans have no verified physical calibration; PLY/SOG assets carry no physical-unit declaration. Distances therefore remain labeled **model units**. Splat picks estimate a surface from rendered Gaussians. See [measurement details](docs/measurement.md).

## Annotations

The annotation icon opens notes for either the current selection or a surface point. After selecting an area, **Annotate selection** opens the editor directly; Q is optional between tools. Enter a title and note, then Save annotation. With no selection, click a visible surface to place a point note. **Place point instead** allows a point annotation while retaining the current selection.

Numbered hotspots display notes when clicked in navigation or annotation mode. The annotation panel lists notes for editing or deletion. **Select annotated area** restores its independent region snapshot and focuses it, even after the current selection has changed. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo saved annotation edits while this tool is active; text fields retain ordinary text editing and Q input. Q/Escape exits the tool after leaving a text field. Alt/Option orbit, pan, and zoom remain available.

Hotspots use PlayCanvas's bundled `Annotation` and `AnnotationManager` scripts, with a small container adapter for our embedded/fullscreen viewer. Point placement shares measurement's GPU picker; annotation layers are excluded from surface/depth picking. Text renders as plain text. Region masks reuse selection history's bit packing. Notes remain in memory until leaving the asset; persistent saved views and WebXR are deferred in [TODO.md](TODO.md).

The remaining work is tracked in [TODO.md](TODO.md), including saved views, WebXR, calibration, selection accuracy, thumbnails, and turntable previews.

## AWS demo deployment notes

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
