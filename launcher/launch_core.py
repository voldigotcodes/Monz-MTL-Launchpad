from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional

import config
import copy_templates
from folder_parser import parse_launch_folder
from meta_api import MetaAPI


class LaunchAPI(MetaAPI):
    """Thin wrapper to soften video thumbnail requirements without touching meta_api."""

    def _fetch_thumbnail_uri(self, video_id: str, attempts: int = 6, delay_sec: float = 1.5) -> str:
        for _ in range(attempts):
            result = self._get(f"{video_id}/thumbnails")
            thumbnails = result.get("data") or []
            if thumbnails:
                uri = thumbnails[0].get("uri")
                if uri:
                    return uri
            time.sleep(delay_sec)
        return ""

    def upload_media_and_create_creative(
        self,
        file_path: Path,
        page_id: str,
        product_url: str,
        instagram_account_id: str,
        primary_text: str,
        headline: str,
        description: str,
    ) -> str:
        extension = file_path.suffix.lower()
        if extension in {".mp4", ".mov", ".avi", ".m4v"}:
            video_id = self.upload_video(file_path)
            thumbnail_url = self._fetch_thumbnail_uri(video_id)
            if not thumbnail_url:
                raise RuntimeError(f"No thumbnail available for video {video_id}")
            return self.create_ad_creative_video(
                page_id=page_id,
                product_url=product_url,
                instagram_account_id=instagram_account_id,
                primary_text=primary_text,
                headline=headline,
                video_id=video_id,
                thumbnail_url=thumbnail_url,
            )
        return super().upload_media_and_create_creative(
            file_path=file_path,
            page_id=page_id,
            product_url=product_url,
            instagram_account_id=instagram_account_id,
            primary_text=primary_text,
            headline=headline,
            description=description,
        )

LogHook = Callable[[str], None]


@dataclass
class LaunchConfig:
    campaign_folder_path: str
    product_url: str
    product_name: Optional[str] = None
    country: Optional[str] = None
    daily_budget_minor: Optional[int] = None
    campaign_status: str = "PAUSED"
    adset_status: str = "ACTIVE"
    start_time_iso: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict) -> "LaunchConfig":
        campaign_status = data.get("campaign_status") or "PAUSED"
        if isinstance(campaign_status, bool):
            campaign_status = "ACTIVE" if campaign_status else "PAUSED"
        return cls(
            campaign_folder_path=data.get("campaign_folder_path") or data.get("launch_folder_path"),
            product_url=data.get("product_url") or "",
            product_name=data.get("product_name"),
            country=data.get("country"),
            daily_budget_minor=data.get("daily_budget_minor"),
            campaign_status=str(campaign_status).upper(),
            adset_status=(data.get("adset_status") or "ACTIVE").upper(),
            start_time_iso=data.get("start_time_iso"),
        )


def _emit(logs: List[str], log_hook: LogHook | None, message: str) -> None:
    logs.append(message)
    if log_hook:
        log_hook(message)


def _normalize_country(country: Optional[str]) -> str:
    return (country or config.COUNTRY).upper()


def build_preview(campaign_folder_path: str, country: Optional[str] = None) -> Dict:
    """Summarize the launch folder using the same parser as the launcher."""
    campaigns = parse_launch_folder(campaign_folder_path)
    launch_date = date.today().isoformat()
    country_code = _normalize_country(country)

    preview_campaigns: List[Dict] = []
    media_summary = {"images": 0, "videos": 0}
    total_ads = 0

    for campaign in campaigns:
        campaign_name = f"{country_code} - {campaign['name']} - {launch_date}"
        preview_adsets = []

        for adset in campaign["adsets"]:
            image_count = 0
            video_count = 0
            for creative in adset["creatives"]:
                suffix = Path(creative).suffix.lower()
                if suffix in {".mp4", ".mov", ".avi", ".m4v"}:
                    video_count += 1
                elif suffix in {".jpg", ".jpeg", ".png"}:
                    image_count += 1
            ad_count = image_count + video_count
            media_summary["images"] += image_count
            media_summary["videos"] += video_count
            total_ads += ad_count
            preview_adsets.append(
                {
                    "name": adset["name"],
                    "ads": ad_count,
                    "images": image_count,
                    "videos": video_count,
                }
            )

        preview_campaigns.append({"name": campaign_name, "adsets": preview_adsets})

    return {
        "campaigns": preview_campaigns,
        "launch_date": launch_date,
        "total_ads": total_ads,
        "media_summary": media_summary,
    }


def run_launch(raw_config: Dict, log_hook: LogHook | None = None) -> Dict:
    """
    Runs a full campaign launch.
    Returns:
      {
        "campaign_id": str,
        "adset_id": str,
        "ads_created": int,
        "logs": list[str]
      }
    """
    cfg = LaunchConfig.from_dict(raw_config)
    if not cfg.campaign_folder_path:
        raise ValueError("Campaign folder path is required.")
    if not cfg.product_url:
        raise ValueError("Product URL is required.")

    logs: List[str] = []

    campaigns = parse_launch_folder(cfg.campaign_folder_path)
    api = LaunchAPI(config.ACCESS_TOKEN, config.AD_ACCOUNT_ID)
    copy_block = copy_templates.build_copy(cfg.product_url, cfg.product_name)
    launch_date = date.today().isoformat()
    country_code = _normalize_country(cfg.country)
    daily_budget_value = int(cfg.daily_budget_minor or config.DAILY_BUDGET)

    results: List[Dict] = []
    total_ads_created = 0
    first_campaign_id = ""
    first_adset_id = ""

    for campaign in campaigns:
        campaign_name = f"{country_code} - {campaign['name']} - {launch_date}"
        _emit(logs, log_hook, f"Creating campaign: {campaign_name}")
        campaign_id = api.create_campaign(
            name=campaign_name,
            objective=config.OBJECTIVE,
            daily_budget=daily_budget_value,
            status=cfg.campaign_status or "PAUSED",
        )
        if not first_campaign_id:
            first_campaign_id = campaign_id or ""
        campaign_entry = {"campaign_name": campaign_name, "campaign_id": campaign_id, "adsets": []}
        _emit(logs, log_hook, f"Created campaign: {campaign_name} ({campaign_id})")

        for adset in campaign["adsets"]:
            targeting = dict(config.TARGETING)
            targeting["geo_locations"] = {"countries": [country_code]}
            _emit(logs, log_hook, f"  Creating ad set: {adset['name']}")
            adset_id = api.create_ad_set(
                name=adset["name"],
                campaign_id=campaign_id,
                targeting=targeting,
                optimization_event=config.OPTIMIZATION_EVENT,
                pixel_id=config.PIXEL_ID,
                status="ACTIVE",
                start_time=cfg.start_time_iso,
            )
            if not first_adset_id:
                first_adset_id = adset_id or ""
            adset_entry = {"adset_name": adset["name"], "adset_id": adset_id, "ads_created": 0}
            _emit(logs, log_hook, f"  Created ad set: {adset['name']} ({adset_id})")

            for creative_path in adset["creatives"]:
                file_path = Path(creative_path)

                if not file_path.is_file():
                    _emit(logs, log_hook, f"    Skipping missing file: {file_path}")
                    continue

                if file_path.name.startswith("."):
                    continue

                if file_path.suffix.lower() not in {
                    ".jpg",
                    ".jpeg",
                    ".png",
                    ".mp4",
                    ".mov",
                    ".m4v",
                    ".avi",
                }:
                    _emit(logs, log_hook, f"    Unsupported file type, skipping: {file_path.name}")
                    continue

                _emit(logs, log_hook, f"    Uploading creative: {file_path.name}")
                creative_id = api.upload_media_and_create_creative(
                    file_path=file_path,
                    page_id=config.PAGE_ID,
                    product_url=cfg.product_url,
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
                    status="ACTIVE",
                )
                adset_entry["ads_created"] += 1
                total_ads_created += 1
                _emit(logs, log_hook, f"    Created ad: {ad_name} ({ad_id})")

            campaign_entry["adsets"].append(adset_entry)
        results.append(campaign_entry)

    _emit(logs, log_hook, f"Launch complete: {len(results)} campaign(s), {total_ads_created} ad(s) created.")

    return {
        "campaign_id": first_campaign_id,
        "adset_id": first_adset_id,
        "ads_created": total_ads_created,
        "logs": logs,
        "campaigns": results,
    }
