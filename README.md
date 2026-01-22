# Monz MTL Launchpad

Desktop launcher for Meta Ads campaigns. The app wraps the existing Python backend (unchanged CLI) with a Tauri + React UI for daily operator use.

## Components
- **Backend (launcher/)**: Python CLI + `launch_core.py` shared logic (`run_launch`, `build_preview`). Supports carousel folders, active ad sets/ads, and configurable campaign status.
- **Desktop UI (React + Tauri)**: Form, folder picker, preview, live logs, presets/history, and direct calls into the Python backend.

## Quick start (desktop UI)
```bash
npm install
npm run tauri:dev
```
- Requires `python3` with `requests` installed and `launcher/config.py` configured (tokens, ad account, page/IG/pixel, defaults).
- The app sets `PYTHONPATH` to the repo root/launcher when calling Python, so imports resolve.

## Backend CLI (still available)
```bash
python launcher/launch.py --campaign-folder-path /path/to/CampaignFolder --product-url https://example.com
```
See `launcher/README.md` for full flags and folder structure (nested folders in ad sets become carousel ads).

## Project structure
- `launcher/` — backend code and CLI
- `src/` — React UI
- `src-tauri/` — Tauri shell (Rust commands invoke Python)
- `index.html`, `vite.config.ts`, `package.json` — frontend tooling

## Docs
- Backend: `launcher/README.md`
- Frontend/UI: `README-frontend.md`

## Recent UI additions
- Confirmation modal before any launch (single or bulk) showing campaign, preset, URL, folder, and status.
- Copyable live logs and disabled launch buttons while a launch is running to prevent duplicates.
- Success summary modal after launches with campaign/adset/ad counts and time saved estimate.
- Settings tab for Meta credentials (token/account/page/IG/pixel) with “Test connection.”
- Preset guardrail banner when a preset is referenced by Bulk Launch.
