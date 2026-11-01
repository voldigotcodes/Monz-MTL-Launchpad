from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Dict, List, Optional, Tuple

import requests
from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from launcher import config

app = FastAPI(title="Meta utility API", version="1.0.0")

# Ensure `launcher/` is on sys.path so `launcher.launch_core` can import its
# sibling modules via the existing unqualified imports (e.g. `import config`).
LAUNCHER_DIR = Path(__file__).resolve().parent
if str(LAUNCHER_DIR) not in sys.path:
    sys.path.insert(0, str(LAUNCHER_DIR))

from launcher.launch_core import build_preview, run_launch  # noqa: E402
from folder_parser import parse_launch_folder  # noqa: E402


UPLOAD_TTL_SEC = int(os.environ.get("LAUNCHPAD_UPLOAD_TTL_SEC", "21600"))  # 6h
MAX_UPLOAD_FILES = int(os.environ.get("LAUNCHPAD_MAX_UPLOAD_FILES", "5000"))
MAX_ZIP_BYTES = int(os.environ.get("LAUNCHPAD_MAX_ZIP_BYTES", str(512 * 1024 * 1024)))  # 512MB


@dataclass
class UploadInfo:
    base_dir: Path
    root_dir: Path
    created_at: float


@dataclass
class LaunchJob:
    job_id: str
    upload_id: str
    status: str  # pending|running|success|error
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    logs: list[str] = None  # type: ignore[assignment]
    result: dict | None = None
    error: str | None = None

    def __post_init__(self) -> None:
        if self.logs is None:
            self.logs = []


_UPLOADS_LOCK = threading.Lock()
_UPLOADS: Dict[str, UploadInfo] = {}

_JOBS_LOCK = threading.Lock()
_JOBS: Dict[str, LaunchJob] = {}


def _allowed_origins() -> List[str]:
    raw = os.environ.get("META_ALLOWED_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if not origins:
        origins = [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _graph_get(endpoint: str, params: Optional[dict] = None) -> dict:
    config.refresh()
    if not config.ACCESS_TOKEN:
        raise HTTPException(status_code=400, detail={
            "code": "token_missing", "message": "META_ACCESS_TOKEN is missing from backend configuration."
        })
    url = f"https://graph.facebook.com/{config.GRAPH_API_VERSION}/{endpoint}"
    try:
        resp = requests.get(
            url, params=dict(params or {}),
            headers={"Authorization": f"Bearer {config.ACCESS_TOKEN}"}, timeout=10,
        )
    except requests.RequestException:
        raise HTTPException(status_code=502, detail={
            "code": "meta_unreachable", "message": "The backend could not reach Meta. Try again."
        }) from None
    try:
        data = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail={
            "code": "meta_invalid_response", "message": "Meta returned an invalid response."
        }) from None
    if not resp.ok:
        # Never forward raw responses or request exceptions: they can contain credentials.
        error = data.get("error", {}) if isinstance(data, dict) else {}
        if not isinstance(error, dict):
            error = {}
        if error.get("code") == 190 or resp.status_code == 401:
            code, message = "token_rejected", "Meta rejected the access token. It may be expired or invalid."
        elif endpoint.startswith("act_"):
            code, message = "account_inaccessible", "Meta could not access the configured ad account. Check its ID and token permissions."
        else:
            code, message = "meta_rejected", "Meta rejected the request. Check the configured IDs and token permissions."
        raise HTTPException(status_code=resp.status_code, detail={"code": code, "message": message})
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail={
            "code": "meta_invalid_response", "message": "Meta returned an invalid response."
        })
    return data


def _ad_account_id() -> str:
    act_id = config.AD_ACCOUNT_ID.removeprefix("act_")
    if not act_id or not act_id.isascii() or not act_id.isdigit():
        raise HTTPException(status_code=400, detail={
            "code": "account_missing_or_invalid", "message": "Set a valid META_AD_ACCOUNT_ID in backend configuration."
        })
    return f"act_{act_id}"


@app.get("/meta/config")
def meta_config():
    """Expose configuration status and public IDs, never the token."""
    config.refresh()
    return {
        "tokenConfigured": bool(config.ACCESS_TOKEN),
        "businessId": config.read_asset_selection().get("businessId", ""),
        "adAccountId": config.AD_ACCOUNT_ID,
        "pageId": config.PAGE_ID,
        "instagramUserId": config.INSTAGRAM_ACCOUNT_ID or "",
        "pixelId": config.PIXEL_ID,
    }


from launcher.meta_assets import asset_router  # noqa: E402

app.include_router(asset_router(_graph_get, meta_config))


@app.get("/meta/connection")
def meta_connection():
    config.refresh()
    if not config.ACCESS_TOKEN:
        raise HTTPException(status_code=400, detail={
            "code": "token_missing", "message": "META_ACCESS_TOKEN is missing from backend configuration."
        })
    act_id = _ad_account_id()
    user = _graph_get("me", {"fields": "id,name"})
    account = _graph_get(act_id, {"fields": "id,name,account_status"})
    return {
        "ok": True,
        "user": {"id": user.get("id"), "name": user.get("name")},
        "adAccount": {
            "id": account.get("id"), "name": account.get("name"),
            "status": account.get("account_status"),
        },
    }


@app.get("/meta/campaigns")
def list_campaigns():
    """Return campaigns for the configured ad account."""
    config.refresh()
    act_id = _ad_account_id()
    data = _graph_get(
        f"{act_id}/campaigns",
        params={"fields": "id,name,status,effective_status,daily_budget", "limit": 200},
    )
    return data.get("data", [])


@app.get("/meta/campaigns/{campaign_id}/adsets")
def list_adsets(campaign_id: str):
    data = _graph_get(
        f"{campaign_id}/adsets",
        params={"fields": "id,name,status,effective_status", "limit": 300},
    )
    return data.get("data", [])


@app.get("/meta/ig-status")
def instagram_status():
    """Check whether the configured Instagram business account is reachable with current token."""
    config.refresh()
    ig_id = config.INSTAGRAM_ACCOUNT_ID
    if not ig_id:
        raise HTTPException(status_code=400, detail="INSTAGRAM_ACCOUNT_ID not set in .env")
    data = _graph_get(f"{ig_id}", params={"fields": "id,username"})
    return {"ok": True, "id": data.get("id"), "username": data.get("username")}


@app.get("/health")
def health():
    return {"ok": True}


def _now() -> float:
    return time.time()


def _prune_expired_uploads() -> None:
    cutoff = _now() - UPLOAD_TTL_SEC
    expired: list[Tuple[str, Path]] = []
    with _UPLOADS_LOCK:
        for upload_id, info in list(_UPLOADS.items()):
            if info.created_at < cutoff:
                expired.append((upload_id, info.base_dir))
                del _UPLOADS[upload_id]
    for _, base_dir in expired:
        shutil.rmtree(base_dir, ignore_errors=True)


def _safe_relative_upload_path(filename: str) -> Path:
    normalized = (filename or "").replace("\\", "/").strip()
    rel = PurePosixPath(normalized)
    if not normalized or rel.is_absolute() or ".." in rel.parts:
        raise HTTPException(status_code=400, detail="Invalid uploaded file path.")
    return Path(*rel.parts)


def _detect_single_root_dir(root: Path) -> Path:
    # Prefer a single top-level directory when present (common for folder & zip uploads).
    try:
        entries = [p for p in root.iterdir() if p.name not in {".DS_Store", "__MACOSX"}]
    except OSError:
        return root
    dirs = [p for p in entries if p.is_dir()]
    files = [p for p in entries if p.is_file()]
    if len(dirs) == 1 and not files:
        return dirs[0]
    return root


def _new_upload_dir() -> Path:
    base = Path(os.environ.get("LAUNCHPAD_UPLOAD_ROOT", tempfile.gettempdir())).expanduser().resolve()
    base.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="launchpad_upload_", dir=str(base)))


async def _save_upload_file(target_path: Path, uf: UploadFile) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with target_path.open("wb") as f:
        while True:
            chunk = await uf.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)


def _extract_zip(zip_path: Path, dest_dir: Path) -> None:
    # Prevent Zip Slip by validating member paths.
    with zipfile.ZipFile(zip_path) as zf:
        members = zf.infolist()
        if len(members) > MAX_UPLOAD_FILES:
            raise HTTPException(status_code=413, detail="ZIP contains too many files.")
        for member in members:
            name = member.filename
            if not name or name.endswith("/"):
                continue
            rel = PurePosixPath(name)
            if rel.is_absolute() or ".." in rel.parts:
                raise HTTPException(status_code=400, detail="ZIP contains invalid paths.")
            target = dest_dir / Path(*rel.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)


@app.post("/uploads")
async def create_upload(
    files: List[UploadFile] | None = File(default=None),
    zip_file: UploadFile | None = File(default=None, alias="zip"),
):
    """
    Create a temporary upload on the backend.

    - Folder upload: send multiple files and set the per-file `filename` to include the relative path
      (e.g. `Campaign/AdsetA/creative.jpg`) so the backend can reconstruct the folder structure.
    - ZIP upload: send a single `.zip` file field named `zip`.
    """
    _prune_expired_uploads()

    if not files and not zip_file:
        raise HTTPException(status_code=400, detail="Provide either files[] or zip.")

    upload_dir = _new_upload_dir()
    root_hint: str | None = None

    try:
        if zip_file is not None:
            name = (zip_file.filename or "").lower()
            if not name.endswith(".zip"):
                raise HTTPException(status_code=400, detail="Only .zip archives are supported.")
            zip_path = upload_dir / "upload.zip"
            await _save_upload_file(zip_path, zip_file)
            if zip_path.stat().st_size > MAX_ZIP_BYTES:
                raise HTTPException(status_code=413, detail="ZIP too large.")
            _extract_zip(zip_path, upload_dir)
            zip_path.unlink(missing_ok=True)  # type: ignore[arg-type]

        if files:
            if len(files) > MAX_UPLOAD_FILES:
                raise HTTPException(status_code=413, detail="Too many uploaded files.")
            for uf in files:
                if not uf.filename:
                    continue
                rel_path = _safe_relative_upload_path(uf.filename)
                if root_hint is None and rel_path.parts:
                    root_hint = rel_path.parts[0]
                target = upload_dir / rel_path
                await _save_upload_file(target, uf)

        root_dir = (upload_dir / root_hint) if root_hint else upload_dir
        if not root_dir.exists() or not root_dir.is_dir():
            root_dir = _detect_single_root_dir(upload_dir)

        upload_id = uuid.uuid4().hex
        with _UPLOADS_LOCK:
            _UPLOADS[upload_id] = UploadInfo(base_dir=upload_dir, root_dir=root_dir, created_at=_now())
        return {"upload_id": upload_id}
    except HTTPException:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}") from exc


def _get_upload_root(upload_id: str) -> Path:
    _prune_expired_uploads()
    with _UPLOADS_LOCK:
        info = _UPLOADS.get(upload_id)
    if not info:
        raise HTTPException(status_code=404, detail="Unknown or expired upload_id.")
    if not info.root_dir.exists():
        raise HTTPException(status_code=410, detail="Upload no longer available.")
    return info.root_dir


@app.get("/uploads/{upload_id}/preview")
def preview_upload(
    upload_id: str,
    country: str | None = Query(default=None),
    launch_type: str | None = Query(default=None),
    add_mode: str | None = Query(default=None),
    campaign_id: str | None = Query(default=None),
):
    root = _get_upload_root(upload_id)
    try:
        if (launch_type or "").lower() == "existing_campaign" and campaign_id:
            # For existing campaigns, preview should reflect the existing campaign name (no renaming).
            campaign_data = _graph_get(f"{campaign_id}", params={"fields": "id,name,status,daily_budget"})
            campaign_name = campaign_data.get("name") or campaign_id

            campaigns = parse_launch_folder(str(root))
            # Collapse to a single "campaign" preview named after the existing campaign.
            preview_adsets: list[dict] = []
            media_summary = {"images": 0, "videos": 0}
            total_ads = 0

            for parsed_campaign in campaigns:
                for adset in parsed_campaign.get("adsets") or []:
                    image_count = 0
                    video_count = 0
                    ad_count = 0
                    creatives_preview: list[dict] = []

                    for creative in adset.get("creatives") or []:
                        if isinstance(creative, dict) and creative.get("type") == "carousel":
                            items = [Path(p) for p in (creative.get("items") or [])]
                            item_names: list[str] = []
                            for item in items:
                                suffix = item.suffix.lower()
                                if suffix in {".jpg", ".jpeg", ".png"}:
                                    image_count += 1
                                    item_names.append(item.name)
                            ad_count += 1
                            creatives_preview.append(
                                {
                                    "type": "carousel",
                                    "name": str(creative.get("name") or "carousel"),
                                    "items": item_names,
                                }
                            )
                            continue

                        file_path = Path(creative)
                        suffix = file_path.suffix.lower()
                        if suffix in {".mp4", ".mov", ".avi", ".m4v"}:
                            video_count += 1
                            ad_count += 1
                            creatives_preview.append({"type": "video", "name": file_path.name})
                        elif suffix in {".jpg", ".jpeg", ".png"}:
                            image_count += 1
                            ad_count += 1
                            creatives_preview.append({"type": "image", "name": file_path.name})
                        else:
                            creatives_preview.append({"type": "file", "name": file_path.name})

                    media_summary["images"] += image_count
                    media_summary["videos"] += video_count
                    total_ads += ad_count
                    preview_adsets.append(
                        {
                            "name": adset.get("name"),
                            "ads": ad_count,
                            "images": image_count,
                            "videos": video_count,
                            "creatives": creatives_preview,
                        }
                    )

            return {
                "campaigns": [{"name": campaign_name, "adsets": preview_adsets}],
                "launch_date": None,
                "total_ads": total_ads,
                "media_summary": media_summary,
                "existing_campaign": {
                    "id": campaign_data.get("id"),
                    "status": campaign_data.get("status") or campaign_data.get("effective_status"),
                    "daily_budget": campaign_data.get("daily_budget"),
                },
                "mode": {"launch_type": "existing_campaign", "add_mode": add_mode or "creatives_only"},
            }

        return build_preview(str(root), country=country)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _coerce_minor_units(daily_budget: object) -> int:
    if daily_budget is None:
        return int(config.DAILY_BUDGET)
    try:
        return int(round(float(daily_budget) * 100))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="dailyBudget must be a number") from exc


def _translate_launch_payload(payload: dict, *, campaign_folder_path: str) -> dict:
    config.refresh()
    try:
        config.require_meta_settings()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    product_url = (payload.get("productUrl") or payload.get("product_url") or "").strip()
    if not product_url:
        raise HTTPException(status_code=400, detail="productUrl is required")

    schedule_mode = payload.get("scheduleMode") or payload.get("schedule_mode") or "now"
    schedule_time = payload.get("scheduleTime") or payload.get("schedule_time")
    start_time_iso = None
    if str(schedule_mode).lower() == "later":
        if not schedule_time:
            raise HTTPException(status_code=400, detail="scheduleTime is required when scheduleMode is 'later'")
        start_time_iso = schedule_time

    campaign_active = payload.get("campaignActive")
    if campaign_active is None:
        campaign_active = False

    return {
        "campaign_folder_path": campaign_folder_path,
        "_meta_assets": config.asset_ids(),
        "product_url": product_url,
        "product_name": (payload.get("productName") or payload.get("product_name") or "").strip() or None,
        "brand_name": (payload.get("brandName") or payload.get("brand_name") or "").strip() or None,
        "country": (payload.get("country") or config.COUNTRY),
        "daily_budget_minor": _coerce_minor_units(payload.get("dailyBudget") or payload.get("daily_budget")),
        "campaign_status": "ACTIVE" if campaign_active else "PAUSED",
        "adset_status": "ACTIVE",
        "start_time_iso": start_time_iso,
        "preset": payload.get("preset") or None,
        "launchType": payload.get("launchType") or payload.get("launch_type") or "new_campaign",
        "addMode": payload.get("addMode") or payload.get("add_mode") or "creatives_only",
        "campaignId": payload.get("campaignId") or payload.get("campaign_id") or None,
        "targetAdsetIds": payload.get("targetAdsetIds") or payload.get("target_adset_ids") or [],
        "adset_name": (payload.get("adsetName") or payload.get("adset_name") or "").strip() or None,
        "multiAdvertiserAds": bool(payload.get("multiAdvertiserAds") or payload.get("multi_advertiser_ads") or False),
    }


def _run_job(job_id: str, config_dict: dict) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = _now()

    def log_hook(line: str) -> None:
        with _JOBS_LOCK:
            j = _JOBS.get(job_id)
            if j is not None:
                j.logs.append(line)

    try:
        result = run_launch(config_dict, log_hook=log_hook)
        with _JOBS_LOCK:
            j = _JOBS.get(job_id)
            if j is not None:
                j.status = "success"
                j.result = result
                j.finished_at = _now()
    except Exception as exc:
        with _JOBS_LOCK:
            j = _JOBS.get(job_id)
            if j is not None:
                j.status = "error"
                j.error = str(exc)
                j.finished_at = _now()
                j.logs.append(f"ERROR: {exc}")
    finally:
        # Best-effort cleanup of the associated upload to keep disk usage bounded.
        upload_id = None
        with _JOBS_LOCK:
            j = _JOBS.get(job_id)
            if j is not None:
                upload_id = j.upload_id
        if upload_id:
            with _UPLOADS_LOCK:
                info = _UPLOADS.pop(upload_id, None)
            if info:
                shutil.rmtree(info.base_dir, ignore_errors=True)


@app.post("/launch/jobs")
def create_launch_job(payload: dict = Body(...)):
    """
    Start a launch job from a previously created upload.
    Returns a job_id to poll for status and logs.
    """
    _prune_expired_uploads()
    upload_id = payload.get("uploadId") or payload.get("upload_id")
    if not upload_id:
        raise HTTPException(status_code=400, detail="uploadId is required")
    root = _get_upload_root(str(upload_id))
    config_dict = _translate_launch_payload(payload, campaign_folder_path=str(root))

    job_id = uuid.uuid4().hex
    job = LaunchJob(job_id=job_id, upload_id=str(upload_id), status="pending", created_at=_now())
    with _JOBS_LOCK:
        _JOBS[job_id] = job

    t = threading.Thread(target=_run_job, args=(job_id, config_dict), daemon=True, name=f"launch-job-{job_id[:8]}")
    t.start()
    return {"job_id": job_id}


@app.get("/launch/jobs/{job_id}")
def get_launch_job(job_id: str, after: int = Query(default=0, ge=0)):
    """
    Poll job status and incremental logs.
    Pass `after` (0-based log index) to only receive new log lines.
    """
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Unknown job_id.")
        logs_total = len(job.logs)
        slice_start = min(after, logs_total)
        logs = job.logs[slice_start:]
        next_after = logs_total
        return {
            "job_id": job.job_id,
            "status": job.status,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
            "logs": logs,
            "next_after": next_after,
            "result": job.result,
            "error": job.error,
        }
