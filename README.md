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

The React/Vite application includes a temporary professor login screen, browser routing, a debounced server-side catalog search, mesh/splat filters, runtime API validation, and real PlayCanvas mesh and Gaussian-splat loaders. PlayCanvas-provided controls supply orbit, pan, and zoom; splats use the current official camera-controls script and unified renderer.

Locally, Vite proxies `/api/` and `/files/` to the artifact service on port 8080. This preserves the production same-origin request shape without development CORS rules.

## Run locally

Start the artifact service first, then:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) and use the credentials printed by the backend's `npm run setup:local` command. The Vite server is development-only; production uses `npm run build` and serves `dist/` through Nginx.
