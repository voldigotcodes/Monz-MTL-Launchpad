import argparse
from datetime import date, datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog

import config
import copy_templates
from folder_parser import parse_launch_folder
from meta_api import MetaAPI


def launch_campaigns(
    campaign_folder_path: str,
    product_url: str,
    product_name: str | None = None,
    country: str | None = None,
    daily_budget_minor: int | None = None,
    adset_status: str = "PAUSED",
    start_time_iso: str | None = None,
) -> list[dict]:
    campaigns = parse_launch_folder(campaign_folder_path)
    api = MetaAPI(config.ACCESS_TOKEN, config.AD_ACCOUNT_ID)
    copy_block = copy_templates.build_copy(product_url, product_name)
    launch_date = date.today().isoformat()
    country_code = (country or config.COUNTRY).upper()
    daily_budget_value = daily_budget_minor or config.DAILY_BUDGET

    results: list[dict] = []

    for campaign in campaigns:
        campaign_name = f"{country_code} - {campaign['name']} - {launch_date}"
        campaign_id = api.create_campaign(
            name=campaign_name,
            objective=config.OBJECTIVE,
            daily_budget=daily_budget_value,
        )
        campaign_entry = {"campaign_name": campaign_name, "campaign_id": campaign_id, "adsets": []}
        print(f"Created campaign: {campaign_name} ({campaign_id})")

        for adset in campaign["adsets"]:
            targeting = dict(config.TARGETING)
            targeting["geo_locations"] = {"countries": [country_code]}
            adset_id = api.create_ad_set(
                name=adset["name"],
                campaign_id=campaign_id,
                targeting=targeting,
                optimization_event=config.OPTIMIZATION_EVENT,
                pixel_id=config.PIXEL_ID,
                status=adset_status,
                start_time=start_time_iso,
            )
            adset_entry = {"adset_name": adset["name"], "adset_id": adset_id, "ads_created": 0}
            print(f"  Created ad set: {adset['name']} ({adset_id})")

            for creative_path in adset["creatives"]:
                file_path = Path(creative_path)

                if not file_path.is_file():
                    continue

                if file_path.name.startswith("."):
                    continue

                if file_path.suffix.lower() not in {
                    ".jpg", ".jpeg", ".png",
                    ".mp4", ".mov", ".m4v"
                }:
                    continue

                creative_id = api.upload_media_and_create_creative(
                    file_path=file_path,
                    page_id=config.PAGE_ID,
                    product_url=product_url,
                    instagram_account_id=config.INSTAGRAM_ACCOUNT_ID,
                    primary_text=copy_block["primary_text"],
                    headline=copy_block["headline"],
                    description=copy_block["description"],
                )

                ad_name = file_path.stem
                ad_id = api.create_ad(
                    name=ad_name,
                    adset_id=adset_id,
                    creative_id=creative_id,
                )
                adset_entry["ads_created"] += 1
                print(f"    Created ad: {ad_name} ({ad_id})")

            campaign_entry["adsets"].append(adset_entry)
        results.append(campaign_entry)

    return results


def resolve_inputs() -> tuple[str, str, str | None]:
    parser = argparse.ArgumentParser(description="Launch Meta CBO campaigns from a folder.")
    parser.add_argument(
        "--campaign-folder-path",
        "--launch-folder-path",
        dest="campaign_folder_path",
        help="Path to the campaign folder (or parent containing multiple campaigns)",
    )
    parser.add_argument("--product-url", help="Product URL")
    parser.add_argument("--product-name", help="Product name")
    args = parser.parse_args()

    product_url = args.product_url or input("Enter product URL: ").strip()
    product_name = args.product_name or None

    if args.campaign_folder_path:
        campaign_folder_path = args.campaign_folder_path
    else:
        root = tk.Tk()
        root.withdraw()
        campaign_folder_path = filedialog.askdirectory(title="Select campaign folder")
        root.destroy()
        if not campaign_folder_path:
            raise ValueError("No campaign folder selected.")

    return campaign_folder_path, product_url, product_name


def main() -> None:
    campaign_folder_path, product_url, product_name = resolve_inputs()

    results = launch_campaigns(
        campaign_folder_path=campaign_folder_path,
        product_url=product_url,
        product_name=product_name,
    )

    for campaign in results:
        print(f"Campaign: {campaign['campaign_name']} ({campaign['campaign_id']})")
        for adset in campaign["adsets"]:
            print(f"  Ad set: {adset['adset_name']} ({adset['adset_id']}) | Ads: {adset['ads_created']}")


if __name__ == "__main__":
    main()
