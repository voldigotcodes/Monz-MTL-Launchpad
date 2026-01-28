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
    merged = dict(params or {})
    merged["access_token"] = config.ACCESS_TOKEN
    url = f"{GRAPH_BASE}/{endpoint}"
    resp = requests.get(url, params=merged, timeout=10)
    if not resp.ok:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


@app.get("/meta/campaigns")
def list_campaigns():
    """Return campaigns for the configured ad account."""
    act_id = config.AD_ACCOUNT_ID.replace("act_", "")
    data = _graph_get(
        f"act_{act_id}/campaigns",
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
