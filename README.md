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
- Hosting and laptop PWA readiness: [report and Phase 1 implementation prompt](docs/hosting-and-laptop-pwa-readiness.md)
- Ranked fixes: [review and per-task implementation prompts](docs/fixes-review-and-implementation-prompts.md)

## Meta configuration and connectivity

- Install Python dependencies: `python3 -m pip install requests fastapi uvicorn python-multipart`.
- Set `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID`, and `META_PIXEL_ID` in the backend `.env`. `META_INSTAGRAM_ACCOUNT_ID` is optional.
- Set `NEXT_PUBLIC_API_BASE=http://localhost:8000` for Next.js. The previous `VITE_API_BASE` setting is unused. Restart or rebuild Next.js after changing its public API URL.
- The backend reads the same shared configuration for tests, campaign lists, previews, and launch jobs. `.env` changes are refreshed on requests; process environment variables take precedence and require restarting the backend to change.
- Use `LAUNCHPAD_ENV_PATH` to specify an absolute backend `.env` path when starting Python outside this repository.
- Settings shows token presence and searchable asset selectors for business portfolios, ad accounts, Facebook Pages, Instagram identities, and pixels. It never returns the token to the browser. Legacy frontend credential files remain unused.
- `GET /meta/config` reports token presence and public IDs without contacting Meta. `GET /meta/connection` checks user and ad-account access using the backend token. Missing configuration, rejected tokens, account access failures, and network errors have distinct messages. A successful connection check does not guarantee the ad account is active; its status is displayed separately.
- `.next/` and TypeScript build caches are ignored by Git.

## Validation

```bash
npx tsc --noEmit
npm run build
python3 -m unittest discover -s tests -v
```

Backend tests additionally require `httpx`. They mock Meta calls and do not create campaigns.

## Asset selection

Settings lists assets accessible to the current backend token. Business portfolios include their image; accounts show name, currency, status, and ID; Pages and Instagram identities show profile images when available. Search accepts names, IDs, and Instagram usernames. Arrow keys, Enter, Escape, and Tab work in the custom selectors.

Choose a business (or all accessible businesses), then an active ad account. Pages come from the account's promotable Pages and pixels from its available pixels. Instagram choices combine the account's advertising identities and the selected Page's linked professional account. A Page-linked suggestion is shown when available; Instagram can be left empty. Changing a parent clears dependent selections. Missing permissions or partial results are shown explicitly, and pagination is followed server-side.

**Save asset selection** revalidates the combination against Meta and writes only IDs to `.meta-assets.json` at the repository root, excluded from Git. Override that location with `LAUNCHPAD_ASSETS_PATH` if needed (keep any alternate file outside tracked source). These saved IDs override `.env` asset IDs; the token still comes from `.env` or the process environment. Deleting the local selection file restores the `.env` ID defaults. A failed validation or disk write leaves the previous selection intact. Existing jobs keep the IDs captured when queued, while future launches and connectivity tests use the saved selection.

Discovery uses `/meta/assets?kind=permissions|businesses|ad-accounts|pages|pixels|instagram`. Saving uses `PUT /meta/assets/selection`. This is a local installation-wide configuration; separate authenticated users are not isolated by this file. The token's permissions and assigned asset access determine which items appear. Useful permissions include advertising access, `business_management`, `pages_show_list`, `pages_read_engagement`, and `instagram_basic` for broader Instagram profile access; unavailable scopes do not automatically mean all related assets are inaccessible.

## Video upload timeouts

Video uploads use a separate socket inactivity timeout of 600 seconds for both sending and waiting for Meta's response. Ordinary API calls keep their shorter timeouts. For a slower connection, set `META_VIDEO_UPLOAD_TIMEOUT=900` in the backend `.env`. This controls socket inactivity, not the maximum total upload duration. Upload failures are not automatically retried because Meta may already have received the file; check the account's media library before retrying. Logs include the video's file size to help diagnose slow uploads.
