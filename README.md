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
- Requires `python3` with `requests`, `fastapi`, and `uvicorn` installed.
- Configure `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID`, and `META_PIXEL_ID` in the local `.env`; `META_INSTAGRAM_ACCOUNT_ID` is optional.
- Start the local utility backend from the repository root in a separate terminal:
  ```bash
  python3 -m uvicorn launcher.backend:app --host 127.0.0.1 --port 8000
  ```
- Settings, connectivity tests, campaign lists, and launches use Python's shared `launcher/config.py` configuration. The frontend receives token presence and account IDs; it never receives the token.
- For an explicit configuration location (especially packaged desktop builds), set `LAUNCHPAD_ENV_PATH` to the same absolute `.env` path when starting both the utility backend and the desktop app. Existing process environment variables take precedence over `.env` values. Restart both processes after configuration changes.
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
- Settings tab shows backend token status and account/page/IG/pixel IDs, with “Test connectivity” and “Refresh configuration.” Credential editing and Save storage are deferred.
- Preset guardrail banner when a preset is referenced by Bulk Launch.

## Connectivity checks

- `GET /meta/config` reports token presence and public account IDs without contacting Meta.
- `GET /meta/connection` checks the configured user and ad account through Python. A successful check confirms access; the returned account status may still indicate a disabled or restricted account.
- Missing credentials, rejected tokens, inaccessible ad accounts, and network failures produce distinct errors. Missing configuration does not stop backend startup; launches validate required credentials before making Meta requests.
- Settings no longer reads or writes legacy `meta_settings.json` or `meta_settings_local` credentials. Existing copies are not migrated or deleted. Edit `.env` for now.

Run validation with:
```bash
npx tsc --noEmit
npm run build
python3 -m unittest discover -s tests -v
```
The backend tests require `httpx` in addition to the runtime dependencies and mock Meta requests; they do not launch campaigns or contact Meta.
