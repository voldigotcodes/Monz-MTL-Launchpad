# Monz MTL Launchpad — Frontend & Desktop UI

Tauri + React + TypeScript desktop UI that drives the existing Python backend. Focused on operator speed: folder picker, preview, live logs, presets/history, and status controls.

## Stack
- React 18 + Vite
- Tauri 1.x (Rust shell)
- Local utility API on `127.0.0.1:8000` for Meta configuration and read operations; launches use Python subprocesses

## Run in dev
```bash
npm install
npm run tauri:dev
```
Requirements:
- `python3` available on PATH with `requests`, `fastapi`, and `uvicorn` installed.
- Meta credentials in the backend `.env` (see [README.md](README.md)).
- Start `python3 -m uvicorn launcher.backend:app --host 127.0.0.1 --port 8000` from the repository root in a separate terminal.
- When using `LAUNCHPAD_ENV_PATH`, set the same absolute path for the utility backend and desktop app. Restart both after editing configuration.
- The Tauri commands set `PYTHONPATH` to the repo root/launcher when invoking Python.

## Build
```bash
npm run build       # front-end bundle
npm run tauri:build # desktop bundle
```

## UI behaviors
- **Folder picker**: Native dialog; path is passed to Python `build_preview` to summarize campaigns/ad sets/creatives (nested folders inside an ad set become a carousel ad).
- **Preview**: Shows campaign/ad set counts, images/videos, and total ads.
- **Launch**: Calls Python `run_launch`, shows a confirmation modal, streams stdout/stderr to the UI, disables controls while running, and shows a success summary modal (campaign/adset/ad counts, duration, and time saved estimate).
- **Campaign status toggle**: Sets campaign Active/Paused on creation; ad sets/ads are created Active.
- **Bulk Launch**: Per-campaign overrides, lockable global fields, confirmation modal, and post-launch summary.
- **Presets & history**: Stored in `localStorage` (last 10 runs), allows reloading configs.
- **Settings tab**: Reads token presence and account/page/IG/pixel IDs from `/meta/config`. “Test connectivity” calls `/meta/connection`; Meta requests and the access token stay in Python. Fields are read-only while credential saving is deferred. Legacy frontend credential storage is unused.
- **Guardrails**: Banner when editing presets that are referenced in Bulk Launch; confirmation before launches.

## Commands (Rust)
- `scan_launch_folder(params)` — invokes Python `launch_core.build_preview`.
- `run_launcher(payload)` — invokes Python `launch.py` with appropriate flags and streams logs.

## Folder conventions (UI mirrors backend)
```
/CampaignFolder
  /AdsetA
    creative1.mp4
    creative2.jpg
  /AdsetB              # nested folders => carousel
    /Carousel1
      frame1.png
      frame2.png
    single.png
```
Ad counts: one ad per file, or one ad per carousel group (>=2 images).

## Testing notes
- Use `npm run tauri:dev` with a sample folder to validate preview and launch.
- Ensure valid Meta credentials in the backend `.env` before live launches.
