import os

import requests


def main() -> None:
    # Prefer loading from `.env` via `launcher/config.py`, but allow direct env usage too.
    access_token = os.environ.get("META_ACCESS_TOKEN")
    ad_account_id = os.environ.get("META_AD_ACCOUNT_ID")
    graph_version = (os.environ.get("META_GRAPH_API_VERSION") or "v18.0").strip()
    if graph_version and not graph_version.startswith("v"):
        graph_version = f"v{graph_version}"

    if not access_token or not ad_account_id:
        raise SystemExit(
            "Missing META_ACCESS_TOKEN and/or META_AD_ACCOUNT_ID. "
            "Set them in your environment or create a local `.env` (see `.env.example`)."
        )

    url = f"https://graph.facebook.com/{graph_version}/{ad_account_id}/campaigns"
    params = {
        "access_token": access_token,
        "fields": "id,name,status",
    }

    resp = requests.get(url, params=params, timeout=(10, 60))
    resp.raise_for_status()
    print(resp.json())


if __name__ == "__main__":
    main()
