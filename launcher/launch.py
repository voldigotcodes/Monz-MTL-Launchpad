import argparse
import json
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog

import config
from launch_core import run_launch


def _prompt_folder() -> str:
    root = tk.Tk()
    root.withdraw()
    campaign_folder_path = filedialog.askdirectory(title="Select campaign folder")
    root.destroy()
    if not campaign_folder_path:
        raise ValueError("No campaign folder selected.")
    return campaign_folder_path


def _to_minor_units(value: float | int | None) -> int:
    if value is None:
        return config.DAILY_BUDGET
    return int(float(value) * 100)


def resolve_inputs() -> tuple[dict, bool]:
    parser = argparse.ArgumentParser(description="Launch Meta CBO campaigns from a folder.")
    parser.add_argument(
        "--campaign-folder-path",
        "--launch-folder-path",
        dest="campaign_folder_path",
        help="Path to the campaign folder (or parent containing multiple campaigns)",
    )
    parser.add_argument("--product-url", help="Product URL")
    parser.add_argument("--product-name", help="Product name")
    parser.add_argument("--country", help="Country code override (e.g., CA, US)")
    parser.add_argument("--daily-budget", type=float, help="Daily budget in currency units (e.g., 80 = $80)")
    parser.add_argument("--start-time-iso", help="Scheduled start time in ISO format")
    parser.add_argument("--launch-now", action="store_true", help="Activate ad sets immediately")
    parser.add_argument("--json-output", action="store_true", help="Print JSON summary after run")
    parser.add_argument("--summary-file", help="Path to write JSON summary (keeps stdout for logs)")
    parser.add_argument("--campaign-status", choices=["ACTIVE", "PAUSED"], help="Campaign status on creation")
    args = parser.parse_args()

    product_url = args.product_url or input("Enter product URL: ").strip()
    product_name = args.product_name or None

    if args.campaign_folder_path:
        campaign_folder_path = args.campaign_folder_path
    else:
        campaign_folder_path = _prompt_folder()

    start_time_iso = args.start_time_iso or None
    adset_status = "ACTIVE"
    campaign_status = (args.campaign_status or ("ACTIVE" if args.launch_now else "PAUSED")).upper()

    config_dict = {
        "campaign_folder_path": campaign_folder_path,
        "product_url": product_url,
        "product_name": product_name,
        "country": args.country or config.COUNTRY,
        "daily_budget_minor": _to_minor_units(args.daily_budget),
        "campaign_status": campaign_status,
        "adset_status": adset_status,
        "start_time_iso": start_time_iso,
        "summary_file": args.summary_file,
    }
    return config_dict, args.json_output


def main() -> None:
    config_dict, json_output = resolve_inputs()

    result = run_launch(config_dict, log_hook=lambda msg: print(msg, flush=True))

    for campaign in result["campaigns"]:
        print(f"Campaign: {campaign['campaign_name']} ({campaign['campaign_id']})")
        for adset in campaign["adsets"]:
            print(f"  Ad set: {adset['adset_name']} ({adset['adset_id']}) | Ads: {adset['ads_created']}")

    if json_output:
        print(json.dumps(result, indent=2, default=str))
    if summary_path := config_dict.get("summary_file"):
        Path(summary_path).expanduser().write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
