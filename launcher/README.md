# Meta CBO Launch Automation (Backend)

Python backend that powers the CLI and the web UI (via FastAPI). Creates CBO Meta campaigns from a folder structure using a system user token (Graph API v18). One campaign per top-level folder, one ad set per subfolder, one ad (or carousel) per creative grouping.

## Files
- `launch.py` — CLI entrypoint; prompts for inputs and launches campaigns.
- `launch_core.py` — shared launch logic (`run_launch`, `build_preview`) for both CLI and UI.
- `config.py` — all defaults (account/page/pixel/instagram, budget, targeting, objective, currency).
- `copy_templates.py` — primary text, headline, description templates parameterized by product URL.
- `folder_parser.py` — parses the launch folder into campaigns/ad sets/creatives.
- `meta_api.py` — thin wrapper over Meta Marketing API for campaign/ad set/ad/creative creation and media upload.

## Prerequisites
- Python 3.10+.
- `pip install requests fastapi uvicorn python-multipart`.
- Valid Meta system user access token with permissions for the configured ad account/page/pixel.
- Desktop environment for Tk folder picker (or provide the folder path via CLI).

## Run API server (web UI backend)
```bash
python3 -m uvicorn launcher.backend:app --reload --port 8000
```
Key endpoints:
- `POST /uploads` (folder/files/zip) → `upload_id`
- `GET /uploads/{upload_id}/preview`
- `POST /launch/jobs` → `job_id`
- `GET /launch/jobs/{job_id}?after=N` (poll logs + status)

## Configure defaults
Edit `config.py` before running. Set:
- `COUNTRY`, `CURRENCY`
- `GRAPH_API_VERSION` (or env `META_GRAPH_API_VERSION`, e.g. `v18.0`)
- `AD_ACCOUNT_ID` (with `act_` prefix)
- `PAGE_ID`, `INSTAGRAM_ACCOUNT_ID`, `PIXEL_ID`, `ACCESS_TOKEN`
- `OBJECTIVE`, `DAILY_BUDGET` (minor units), `OPTIMIZATION_EVENT`
- `TARGETING` (location only; Advantage+ audience on)

## Folder structure
```
/CampaignFolder   <- select this folder in the picker (or pass via CLI)
  /AdsetA
    creative1.mp4
    creative2.jpg
  /AdsetB                  # each child folder becomes a carousel
    /Carousel1
      frame1.png
      frame2.png
    single.png             # still allowed alongside carousels
```
- Pick the campaign folder directly; the tool treats each subfolder as an ad set. Nested folders inside an ad set become a single carousel ad (>=2 images).
- If you select a parent folder containing multiple campaign folders, each child folder becomes a campaign.
- One ad per file (name = filename without extension). Images upload as hashes; videos upload as IDs.

## Copy templates
All ads share copy built from `copy_templates.py` with `product_url`.

## Running
From repository root:
```
python launcher/launch.py --campaign-folder-path /path/to/CampaignFolder --product-url https://example.com
```
- If `--campaign-folder-path` is omitted, a folder picker opens (select the campaign folder).
- If `--product-url` is omitted, the script prompts in the terminal.

### CLI flags
- `--product-name` — optional product name for copy
- `--country` — override country code (default from config)
- `--daily-budget` — budget in currency units (80 -> 8000 minor)
- `--launch-now` or `--start-time-iso` — schedule/activate ad sets
- `--campaign-status ACTIVE|PAUSED` — campaign status on creation (ad sets/ads are created Active)
- `--summary-file` — write JSON summary to a file
- `--json-output` — also print JSON to stdout

## Behavior
- Campaign name: `COUNTRY - <CampaignFolder> - YYYY-MM-DD`.
- Campaign type: CBO, Auction, `DAILY_BUDGET` applied, bid strategy LOWEST_COST_WITHOUT_CAP.
- Campaign status: configurable (default PAUSED). Ad sets and ads are created ACTIVE.
- Ad sets: one per subfolder, website conversions, optimization goal Purchase, Advantage+ audience ON with location from `config.py`, no placements specified (Meta defaults).
- Ads: one per creative file, or one per carousel group (>=2 images in a nested folder). Creatives auto-uploaded (video thumbnails fetched after upload), identity from `PAGE_ID`/`INSTAGRAM_ACCOUNT_ID`, destination URL appends `?tw_source={{site_source_name}}&tw_adid={{ad.id}}`.
- Fails fast on any API error (raises RuntimeError).
