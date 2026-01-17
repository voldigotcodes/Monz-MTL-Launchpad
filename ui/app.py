from datetime import datetime
import sys
import tempfile
from pathlib import Path
from typing import Optional

from flask import Flask, render_template, request

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BASE_DIR / "launcher"))

import launch  # noqa: E402


app = Flask(__name__)


def parse_datetime_local(dt_str: str) -> Optional[str]:
    if not dt_str:
        return None
    local_tz = datetime.now().astimezone().tzinfo
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=local_tz)
    return dt.isoformat()


def dollars_to_minor_units(amount: str) -> int:
    value = float(amount)
    return int(value * 100)


@app.route("/", methods=["GET"])
def index():
    return render_template(
        "index.html",
        result=None,
        error=None,
        defaults={
            "country": "CA",
            "daily_budget": 80,
        },
    )


@app.route("/launch", methods=["POST"])
def launch_campaigns():
    uploaded_files = request.files.getlist("folder")
    product_name = request.form.get("product_name", "").strip()
    product_url = request.form.get("product_url", "").strip()
    country = request.form.get("country", "CA").strip() or "CA"
    launch_datetime = request.form.get("launch_datetime", "").strip()
    launch_immediately = request.form.get("launch_immediately") == "on"
    daily_budget_str = request.form.get("daily_budget", "80").strip()

    if not uploaded_files or all(not f.filename for f in uploaded_files):
        error = "Folder is required."
        return render_template("index.html", error=error, result=None, defaults={"country": country, "daily_budget": daily_budget_str})

    if not product_url or not product_name:
        error = "Product name and product URL are required."
        return render_template("index.html", error=error, result=None, defaults={"country": country, "daily_budget": daily_budget_str})

    if not launch_immediately and not launch_datetime:
        error = "Launch date & time is required unless launching immediately."
        return render_template("index.html", error=error, result=None, defaults={"country": country, "daily_budget": daily_budget_str})

    try:
        daily_budget_minor = dollars_to_minor_units(daily_budget_str)
    except Exception:
        error = "Daily budget must be a valid number."
        return render_template("index.html", error=error, result=None, defaults={"country": country, "daily_budget": daily_budget_str})

    start_time_iso = None if launch_immediately else parse_datetime_local(launch_datetime)
    adset_status = "ACTIVE" if launch_immediately or start_time_iso else "PAUSED"

    temp_root = Path(tempfile.mkdtemp(prefix="launch_upload_"))
    root_folder: Optional[Path] = None
    for fs in uploaded_files:
        if not fs.filename:
            continue
        rel_path = Path(fs.filename)
        if root_folder is None and rel_path.parts:
            root_folder = temp_root / rel_path.parts[0]
        target_path = temp_root / rel_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        fs.save(target_path)

    campaign_folder_path = str(root_folder or temp_root)

    try:
        results = launch.launch_campaigns(
            campaign_folder_path=campaign_folder_path,
            product_url=product_url,
            product_name=product_name,
            country=country,
            daily_budget_minor=daily_budget_minor,
            adset_status=adset_status,
            start_time_iso=start_time_iso,
        )
        total_ads = sum(adset["ads_created"] for c in results for adset in c["adsets"])
        result_summary = {
            "campaigns": results,
            "total_ads": total_ads,
        }
        return render_template("index.html", result=result_summary, error=None, defaults={"country": country, "daily_budget": daily_budget_str})
    except Exception as exc:
        return render_template("index.html", error=str(exc), result=None, defaults={"country": country, "daily_budget": daily_budget_str})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
