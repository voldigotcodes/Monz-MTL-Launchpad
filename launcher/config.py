import os
import json
import tempfile
from pathlib import Path


_PROCESS_ENV = dict(os.environ)
_DOTENV_KEYS: set[str] = set()


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return values

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            values[key] = val
    return values


def _load_dotenv() -> None:
    candidates: list[Path] = []
    if raw := os.environ.get("LAUNCHPAD_ENV_PATH", "").strip():
        candidates.append(Path(raw).expanduser())
    candidates.append(Path.cwd() / ".env")
    candidates.append(Path(__file__).resolve().parent.parent / ".env")

    merged: dict[str, str] = {}
    seen: set[Path] = set()
    for p in candidates:
        try:
            resolved = p.expanduser().resolve()
        except OSError:
            resolved = p
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.exists():
            for key, value in _read_env_file(resolved).items():
                merged.setdefault(key, value)

    for key in list(_DOTENV_KEYS):
        if key in _PROCESS_ENV:
            _DOTENV_KEYS.discard(key)
            continue
        if key not in merged:
            os.environ.pop(key, None)
            _DOTENV_KEYS.discard(key)

    for key, value in merged.items():
        if key in _PROCESS_ENV:
            continue
        os.environ[key] = value
        _DOTENV_KEYS.add(key)


def _get_env(key: str, default: str | None = None) -> str:
    value = os.environ.get(key, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


def _normalize_graph_version(value: str | None) -> str:
    raw = (value or "").strip() or "v18.0"
    return raw if raw.startswith("v") else f"v{raw}"


def refresh() -> None:
    _load_dotenv()

    global COUNTRY
    global CURRENCY
    global GRAPH_API_VERSION
    global AD_ACCOUNT_ID
    global PAGE_ID
    global INSTAGRAM_ACCOUNT_ID
    global PIXEL_ID
    global ACCESS_TOKEN
    global OBJECTIVE
    global DAILY_BUDGET
    global OPTIMIZATION_EVENT
    global TARGETING

    COUNTRY = os.environ.get("META_COUNTRY", "CA")
    CURRENCY = os.environ.get("META_CURRENCY", "CAD")
    GRAPH_API_VERSION = _normalize_graph_version(os.environ.get("META_GRAPH_API_VERSION", "v18.0"))
    AD_ACCOUNT_ID = _get_env("META_AD_ACCOUNT_ID", "").strip()
    PAGE_ID = _get_env("META_PAGE_ID", "").strip()
    INSTAGRAM_ACCOUNT_ID = os.environ.get("META_INSTAGRAM_ACCOUNT_ID", "").strip() or None
    PIXEL_ID = _get_env("META_PIXEL_ID", "").strip()
    ACCESS_TOKEN = _get_env("META_ACCESS_TOKEN", "").strip()
    OBJECTIVE = os.environ.get("META_OBJECTIVE", "OUTCOME_SALES")
    DAILY_BUDGET = int(os.environ.get("META_DAILY_BUDGET", "8000"))  # cents/minor units
    OPTIMIZATION_EVENT = os.environ.get("META_OPTIMIZATION_EVENT", "OFFSITE_CONVERSIONS")
    TARGETING = {"geo_locations": {"countries": [COUNTRY]}}
    selected = read_asset_selection()
    AD_ACCOUNT_ID = selected.get("adAccountId", AD_ACCOUNT_ID)
    PAGE_ID = selected.get("pageId", PAGE_ID)
    INSTAGRAM_ACCOUNT_ID = selected.get("instagramUserId", INSTAGRAM_ACCOUNT_ID) or None
    PIXEL_ID = selected.get("pixelId", PIXEL_ID)


def asset_selection_path() -> Path:
    return Path(os.environ.get("LAUNCHPAD_ASSETS_PATH") or Path(__file__).resolve().parent.parent / ".meta-assets.json").expanduser()


def read_asset_selection() -> dict:
    path = asset_selection_path()
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or any(
        key not in {"businessId", "adAccountId", "pageId", "instagramUserId", "pixelId"} or not isinstance(value, str)
        for key, value in data.items()
    ):
        raise ValueError("Invalid saved Meta asset selection.")
    return data


def save_asset_selection(selected: dict) -> None:
    """Persist validated public IDs atomically; credentials never enter this file."""
    allowed = {"businessId", "adAccountId", "pageId", "instagramUserId", "pixelId"}
    if set(selected) != allowed or any(not isinstance(value, str) for value in selected.values()):
        raise ValueError("Invalid Meta asset selection.")
    path = asset_selection_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = stream.name
            json.dump(selected, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and Path(temporary).exists():
            Path(temporary).unlink()


refresh()


def asset_ids() -> dict:
    return {"adAccountId": AD_ACCOUNT_ID, "pageId": PAGE_ID, "pixelId": PIXEL_ID, "instagramUserId": INSTAGRAM_ACCOUNT_ID or ""}


def require_meta_settings(selected: dict | None = None) -> None:
    """Validate at launch time so missing credentials don't prevent setup or preview."""
    selected = selected if selected is not None else asset_ids()
    required = {
        "META_ACCESS_TOKEN": ACCESS_TOKEN,
        "META_AD_ACCOUNT_ID": selected.get("adAccountId"),
        "META_PAGE_ID": selected.get("pageId"),
        "META_PIXEL_ID": selected.get("pixelId"),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise ValueError(f"Missing Meta configuration: {', '.join(missing)}")
