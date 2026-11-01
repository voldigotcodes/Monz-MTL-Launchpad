import os
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from launcher import config

GRAPH_VERSION = "v18.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"

app = FastAPI(title="Meta utility API", version="1.0.0")


def _allowed_origins() -> List[str]:
    raw = os.environ.get("META_ALLOWED_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if not origins:
        origins = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "tauri://localhost",
            "app://localhost",
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
    if not config.ACCESS_TOKEN:
        raise HTTPException(status_code=400, detail={
            "code": "token_missing", "message": "META_ACCESS_TOKEN is missing from backend configuration."
        })
    url = f"{GRAPH_BASE}/{endpoint}"
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
    return {
        "tokenConfigured": bool(config.ACCESS_TOKEN),
        "adAccountId": config.AD_ACCOUNT_ID,
        "pageId": config.PAGE_ID,
        "instagramUserId": config.INSTAGRAM_ACCOUNT_ID or "",
        "pixelId": config.PIXEL_ID,
    }


@app.get("/meta/connection")
def meta_connection():
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
    ig_id = config.INSTAGRAM_ACCOUNT_ID
    if not ig_id:
        raise HTTPException(status_code=400, detail="INSTAGRAM_ACCOUNT_ID not set in .env")
    data = _graph_get(f"{ig_id}", params={"fields": "id,username"})
    return {"ok": True, "id": data.get("id"), "username": data.get("username")}


@app.get("/health")
def health():
    return {"ok": True}
