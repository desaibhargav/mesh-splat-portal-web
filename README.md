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
