# Monz MTL Launchpad

Browser-based launcher for Meta Ads campaigns. The app wraps the existing Python backend (CLI + shared launch logic) with a Next.js web UI.

## Components
- **Backend (launcher/)**: Python CLI + `launch_core.py` shared logic (`run_launch`, `build_preview`). Supports carousel folders, active ad sets/ads, and configurable campaign status.
- **Web UI (Next.js)**: Uploads, form state, preview, polling logs/results, and preset management. Never calls Meta APIs directly.

## Quick start (web UI)
```bash
npm install
npm run dev
```
Also start the backend API (example):
```bash
python3 -m uvicorn launcher.backend:app --reload --port 8000
```

## Backend CLI (still available)
```bash
python launcher/launch.py --campaign-folder-path /path/to/CampaignFolder --product-url https://example.com
```
See `launcher/README.md` for full flags and folder structure (nested folders in ad sets become carousel ads).

## Project structure
- `launcher/` — backend code and CLI
- `app/`, `components/`, `lib/` — Next.js web UI

## Docs
- Backend: `launcher/README.md`
- Frontend/UI: `README-frontend.md`
