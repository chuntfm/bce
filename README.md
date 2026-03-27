# Bandcamp Explorer

A fork of the original [Bandcamp Explorer](https://bc-explorer.app/) by [Ron](https://buymeacoffee.com/bc.explorer). Replaces the Streamlit backend and interface with Cloudflare Workers for the backend and static HTML/JS for the frontend.

- `worker/` -- Cloudflare Worker (Hono + TypeScript) that proxies Bandcamp endpoints
- `frontend/` -- Static frontend (vanilla JS), deployed to GitHub Pages
