import os
from pathlib import Path


ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def _get_env(key: str, default: str | None = None) -> str:
    value = os.environ.get(key, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


COUNTRY = os.environ.get("META_COUNTRY", "CA")
CURRENCY = os.environ.get("META_CURRENCY", "CAD")
AD_ACCOUNT_ID = _get_env("META_AD_ACCOUNT_ID")
PAGE_ID = _get_env("META_PAGE_ID")
INSTAGRAM_ACCOUNT_ID = os.environ.get("META_INSTAGRAM_ACCOUNT_ID", "").strip() or None
PIXEL_ID = _get_env("META_PIXEL_ID")
ACCESS_TOKEN = _get_env("META_ACCESS_TOKEN")
OBJECTIVE = os.environ.get("META_OBJECTIVE", "OUTCOME_SALES")
DAILY_BUDGET = int(os.environ.get("META_DAILY_BUDGET", "8000"))  # cents/minor units
OPTIMIZATION_EVENT = os.environ.get("META_OPTIMIZATION_EVENT", "OFFSITE_CONVERSIONS")

TARGETING = {"geo_locations": {"countries": [COUNTRY]}}
