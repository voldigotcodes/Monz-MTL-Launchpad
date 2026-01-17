# Meta CBO Launch Automation

Python CLI that creates paused, CBO Meta campaigns from a local folder structure using a system user token (Graph API v18). One campaign per top-level folder, one ad set per subfolder, one ad per creative file.

## Files
- `launch.py` — entrypoint; prompts for inputs and launches campaigns.
- `config.py` — all defaults (account/page/pixel/instagram, budget, targeting, objective, currency).
- `copy_templates.py` — primary text, headline, description templates parameterized by product URL.
- `folder_parser.py` — parses the launch folder into campaigns/ad sets/creatives.
- `meta_api.py` — thin wrapper over Meta Marketing API for campaign/ad set/ad/creative creation and media upload.

## Prerequisites
- Python 3.10+.
- `pip install requests`.
- Valid Meta system user access token with permissions for the configured ad account/page/pixel.
- Desktop environment for Tk folder picker (or provide the folder path via CLI).

## Configure defaults
Edit `config.py` before running. Set:
- `COUNTRY`, `CURRENCY`
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
  /AdsetB
    creative3.png
```
- Pick the campaign folder directly; the tool treats each subfolder as an ad set.
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

### Flask UI (localhost)
```
python ui/app.py
```
Open `http://127.0.0.1:5000` and submit the form to launch campaigns (supports immediate or scheduled start time).

## Behavior
- Campaign name: `COUNTRY - <CampaignFolder> - YYYY-MM-DD`.
- Campaign type: CBO, Auction, `DAILY_BUDGET` applied, bid strategy LOWEST_COST_WITHOUT_CAP, status PAUSED.
- Ad sets: one per subfolder, status PAUSED, website conversions, optimization goal Purchase, Advantage+ audience ON with location from `config.py`, no placements specified (Meta defaults).
- Ads: one per creative file, status PAUSED, creatives auto-uploaded (video thumbnails auto-generated), identity from `PAGE_ID`/`INSTAGRAM_ACCOUNT_ID`, destination URL appends `?tw_source={{site_source_name}}&tw_adid={{ad.id}}`.
- Fails fast on any API error (raises RuntimeError).
