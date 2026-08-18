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

This repository owns the catalog and viewer user experience. It does not own artifact storage, catalog persistence, authentication policy, or file authorization.

## Current status

The React/Vite application includes a temporary demo login screen, browser routing, a debounced server-side catalog search, mesh/splat filters, runtime API validation, and real PlayCanvas mesh and Gaussian-splat loaders. PlayCanvas-provided controls supply orbit, pan, and zoom; splats use the current official camera-controls script and unified renderer.

Locally, Vite proxies `/api/` and `/files/` to the artifact service on port 8080. This preserves the production same-origin request shape without development CORS rules.

## Run locally

Start the artifact service first, then:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and use the credentials printed by the backend's `npm run setup:local` command. The Vite server is development-only; production uses `npm run build` and serves `dist/` through Nginx.

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

If the portal loads but says the artifact service is unavailable, the static frontend is working and the next step is to configure the `/api/` and `/files/` reverse proxy routes to the backend instance.
