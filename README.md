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
python3 -m uvicorn launcher.backend:app --reload --host 127.0.0.1 --port 8000
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

## Meta configuration and connectivity

- Install Python dependencies: `python3 -m pip install requests fastapi uvicorn python-multipart`.
- Set `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID`, and `META_PIXEL_ID` in the backend `.env`. `META_INSTAGRAM_ACCOUNT_ID` is optional.
- Set `NEXT_PUBLIC_API_BASE=http://localhost:8000` for Next.js. The previous `VITE_API_BASE` setting is unused. Restart or rebuild Next.js after changing its public API URL.
- The backend reads the same shared configuration for tests, campaign lists, previews, and launch jobs. `.env` changes are refreshed on requests; process environment variables take precedence and require restarting the backend to change.
- Use `LAUNCHPAD_ENV_PATH` to specify an absolute backend `.env` path when starting Python outside this repository.
- Settings shows token presence and account/page/Instagram/pixel IDs without returning the token to the browser. Fields are read-only; credential editing and Save storage remain deferred. Legacy frontend credential files are unused and are not migrated or deleted.
- `GET /meta/config` reports token presence and public IDs without contacting Meta. `GET /meta/connection` checks user and ad-account access using the backend token. Missing configuration, rejected tokens, account access failures, and network errors have distinct messages. A successful connection check does not guarantee the ad account is active; its status is displayed separately.
- `.next/` and TypeScript build caches are ignored by Git.

## Validation

```bash
npx tsc --noEmit
npm run build
python3 -m unittest discover -s tests -v
```

Backend tests additionally require `httpx`. They mock Meta calls and do not create campaigns.
