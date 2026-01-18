# Monz MTL Launchpad — Frontend & Desktop UI

Tauri + React + TypeScript desktop UI that drives the existing Python backend. Focused on operator speed: folder picker, preview, live logs, presets/history, and status controls.

## Stack
- React 18 + Vite
- Tauri 1.x (Rust shell)
- Local-only; no network/backend server besides Python subprocess calls

## Run in dev
```bash
npm install
npm run tauri:dev
```
Requirements:
- `python3` available on PATH with `requests` installed.
- `launcher/config.py` populated (tokens, account/page/IG/pixel).
- The Tauri commands set `PYTHONPATH` to the repo root/launcher when invoking Python.

## Build
```bash
npm run build       # front-end bundle
npm run tauri:build # desktop bundle
```

## UI behaviors
- **Folder picker**: Native dialog; path is passed to Python `build_preview` to summarize campaigns/ad sets/creatives (nested folders inside an ad set become a carousel ad).
- **Preview**: Shows campaign/ad set counts, images/videos, and total ads.
- **Launch**: Calls Python `run_launch`, streams stdout/stderr to the UI, disables controls while running.
- **Campaign status toggle**: Sets campaign Active/Paused on creation; ad sets/ads are created Active.
- **Presets & history**: Stored in `localStorage` (last 10 runs), allows reloading configs.

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
- Ensure valid Meta token/account in `launcher/config.py` before live launches.
