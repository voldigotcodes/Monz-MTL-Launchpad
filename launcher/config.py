import os
from pathlib import Path


def _load_env_file(path: Path) -> None:
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def _load_dotenv() -> None:
    candidates: list[Path] = []
    if raw := os.environ.get("LAUNCHPAD_ENV_PATH", "").strip():
        candidates.append(Path(raw).expanduser())
    candidates.append(Path.cwd() / ".env")
    candidates.append(Path(__file__).resolve().parent.parent / ".env")

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
            _load_env_file(resolved)


_load_dotenv()


def _get_env(key: str, default: str | None = None) -> str:
    value = os.environ.get(key, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


COUNTRY = os.environ.get("META_COUNTRY", "CA")
CURRENCY = os.environ.get("META_CURRENCY", "CAD")
AD_ACCOUNT_ID = _get_env("META_AD_ACCOUNT_ID", "").strip()
PAGE_ID = _get_env("META_PAGE_ID", "").strip()
INSTAGRAM_ACCOUNT_ID = os.environ.get("META_INSTAGRAM_ACCOUNT_ID", "").strip() or None
PIXEL_ID = _get_env("META_PIXEL_ID", "").strip()
ACCESS_TOKEN = _get_env("META_ACCESS_TOKEN", "").strip()
OBJECTIVE = os.environ.get("META_OBJECTIVE", "OUTCOME_SALES")
DAILY_BUDGET = int(os.environ.get("META_DAILY_BUDGET", "8000"))  # cents/minor units
OPTIMIZATION_EVENT = os.environ.get("META_OPTIMIZATION_EVENT", "OFFSITE_CONVERSIONS")

TARGETING = {"geo_locations": {"countries": [COUNTRY]}}


def require_meta_settings() -> None:
    """Validate at launch time so missing credentials don't prevent setup or preview."""
    required = {
        "META_ACCESS_TOKEN": ACCESS_TOKEN,
        "META_AD_ACCOUNT_ID": AD_ACCOUNT_ID,
        "META_PAGE_ID": PAGE_ID,
        "META_PIXEL_ID": PIXEL_ID,
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise ValueError(f"Missing Meta configuration: {', '.join(missing)}")
