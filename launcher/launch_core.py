from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re
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
        instagram_account_id: str | None,
        headlines: list[str],
        primary_texts: list[str],
        descriptions: list[str],
    ) -> str:
        extension = file_path.suffix.lower()
        use_asset_feed = self._use_asset_feed(headlines, primary_texts, descriptions)
        if extension in {".mp4", ".mov", ".avi", ".m4v"}:
            video_id = self.upload_video(file_path)
            thumbnail_url = self._fetch_thumbnail_uri(video_id)
            if not thumbnail_url:
                raise RuntimeError(f"No thumbnail available for video {video_id}")
            return self.create_ad_creative_video(
                page_id=page_id,
                product_url=product_url,
                instagram_account_id=instagram_account_id,
                primary_texts=primary_texts,
                headlines=headlines,
                descriptions=descriptions,
                video_id=video_id,
                thumbnail_url=thumbnail_url,
            )
        # Images
        if use_asset_feed:
            if not instagram_account_id:
                raise ValueError("Instagram user ID required when using asset feed creatives.")
            image_hash = self.upload_image(file_path)
            creative_name = headlines[0] if headlines else file_path.stem
            return self.create_ad_creative_asset_feed(
                page_id=page_id,
                instagram_user_id=instagram_account_id,
                destination_url=product_url,
                image_hash=image_hash,
                headlines=headlines,
                primary_texts=primary_texts,
                descriptions=descriptions,
                creative_name=creative_name,
            )
        # Legacy single-text path
        return self.create_ad_creative_link(
            page_id=page_id,
            product_url=product_url,
            instagram_account_id=instagram_account_id,
            headline=headlines[0] if headlines else "",
            primary_text=primary_texts[0] if primary_texts else "",
            description=descriptions[0] if descriptions else "",
            image_hash=self.upload_image(file_path),
        )

    def create_carousel_creative(
        self,
        file_paths: List[Path],
        page_id: str,
        product_url: str,
        instagram_account_id: str | None,
        primary_text: str,
        headline: str,
        description: str,
        per_card_headlines: List[str],
        per_card_descriptions: List[str],
    ) -> str:
        child_attachments = []
        for idx, file_path in enumerate(file_paths):
            image_hash = self.upload_image(file_path)
            card_headline = per_card_headlines[idx] if idx < len(per_card_headlines) else headline
            card_description = per_card_descriptions[idx] if idx < len(per_card_descriptions) else description
            child_attachments.append(
                {
                    "link": product_url,
                    "image_hash": image_hash,
                    "name": card_headline,
                    "description": card_description,
                    "call_to_action": {"type": "SHOP_NOW", "value": {"link": product_url}},
                }
            )

        object_story_spec = {
            "page_id": page_id,
            "link_data": {
                "message": primary_text,
                "link": product_url,
                "child_attachments": child_attachments,
                "multi_share_end_card": False,
                "call_to_action": {"type": "SHOP_NOW", "value": {"link": product_url}},
            },
        }
        if instagram_account_id:
            object_story_spec["instagram_user_id"] = instagram_account_id

        data = {
            "name": headline,
            "object_story_spec": json.dumps(object_story_spec),
        }
        result = self._post(f"{self.ad_account_id}/adcreatives", data=data)
        return result.get("id")

LogHook = Callable[[str], None]


@dataclass
class LaunchConfig:
    campaign_folder_path: str
    product_url: str
    product_name: Optional[str] = None
    brand_name: Optional[str] = None
    country: Optional[str] = None
    daily_budget_minor: Optional[int] = None
    campaign_status: str = "PAUSED"
    adset_status: str = "ACTIVE"
    start_time_iso: Optional[str] = None
    preset: Optional[Dict] = None
    launch_type: str = "new_campaign"
    add_mode: str = "creatives_only"
    campaign_id: Optional[str] = None
    target_adset_ids: Optional[list[str]] = None
    adset_name: Optional[str] = None
    multi_advertiser_ads: bool = False

    @classmethod
    def from_dict(cls, data: Dict) -> "LaunchConfig":
        campaign_status = data.get("campaign_status") or "PAUSED"
        if isinstance(campaign_status, bool):
            campaign_status = "ACTIVE" if campaign_status else "PAUSED"

        preset_data: Optional[Dict] = None
        if env_preset := data.get("preset"):
            preset_data = env_preset
        else:
            try:
                env_json = json.loads(os.environ.get("COPY_PRESET_JSON") or "null")
                if isinstance(env_json, dict):
                    preset_data = env_json
            except Exception:
                preset_data = None

        return cls(
            campaign_folder_path=data.get("campaign_folder_path") or data.get("launch_folder_path"),
            product_url=data.get("product_url") or "",
            product_name=data.get("product_name"),
            brand_name=data.get("brand_name"),
            country=data.get("country"),
            daily_budget_minor=data.get("daily_budget_minor"),
            campaign_status=str(campaign_status).upper(),
            adset_status=(data.get("adset_status") or "ACTIVE").upper(),
            start_time_iso=data.get("start_time_iso"),
            preset=preset_data,
            launch_type=data.get("launchType") or data.get("launch_type") or "new_campaign",
            add_mode=data.get("addMode") or data.get("add_mode") or "creatives_only",
            campaign_id=data.get("campaignId") or data.get("campaign_id"),
            target_adset_ids=data.get("targetAdsetIds") or data.get("target_adset_ids") or [],
            adset_name=(data.get("adsetName") or data.get("adset_name") or None),
            multi_advertiser_ads=bool(data.get("multiAdvertiserAds") or data.get("multi_advertiser_ads") or False),
        )


def _emit(logs: List[str], log_hook: LogHook | None, message: str) -> None:
    logs.append(message)
    if log_hook:
        log_hook(message)


def _normalize_country(country: Optional[str]) -> str:
    return (country or config.COUNTRY).upper()


ALLOWED_VARS = {"product_name", "product_url", "brand_name", "country"}
VAR_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def _resolve_template(template: str, vars_map: Dict[str, str]) -> str:
    def repl(match: re.Match) -> str:
        key = match.group(1)
        if key not in ALLOWED_VARS:
            raise ValueError(f"Unknown variable: {key}")
        return vars_map.get(key, "")

    return VAR_PATTERN.sub(repl, template)


def _coerce_list(value: Optional[List[str]]) -> List[str]:
    if not value:
        return []
    return [str(v) for v in value][:5]


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
            ad_count = 0
            for creative in adset["creatives"]:
                if isinstance(creative, dict) and creative.get("type") == "carousel":
                    items = creative.get("items") or []
                    for item in items:
                        suffix = Path(item).suffix.lower()
                        if suffix in {".jpg", ".jpeg", ".png"}:
                            image_count += 1
                    ad_count += 1
                else:
                    suffix = Path(creative).suffix.lower()
                    if suffix in {".mp4", ".mov", ".avi", ".m4v"}:
                        video_count += 1
                        ad_count += 1
                    elif suffix in {".jpg", ".jpeg", ".png"}:
                        image_count += 1
                        ad_count += 1
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
    if cfg.adset_name and isinstance(cfg.adset_name, str) and cfg.adset_name.strip():
        total_adsets = sum(len(c.get("adsets") or []) for c in campaigns)
        if total_adsets != 1:
            raise ValueError("adset_name can only be used when launching a single ad set.")
        for campaign in campaigns:
            for adset in campaign.get("adsets") or []:
                adset["name"] = cfg.adset_name.strip()
    config.require_meta_settings()
    api = LaunchAPI(config.ACCESS_TOKEN, config.AD_ACCOUNT_ID)

    vars_map = {
        "product_name": cfg.product_name or "",
        "product_url": cfg.product_url,
        "brand_name": cfg.brand_name or "",
        "country": _normalize_country(cfg.country),
    }

    preset = cfg.preset or {}
    headlines = _coerce_list(preset.get("headlines"))
    primary_texts = _coerce_list(preset.get("primaryTexts") or preset.get("primary_texts"))
    descriptions = _coerce_list(preset.get("descriptions"))
    carousel_headlines = _coerce_list(preset.get("carouselHeadlines") or preset.get("carousel_headlines"))
    carousel_descriptions = _coerce_list(preset.get("carouselDescriptions") or preset.get("carousel_descriptions"))

    resolved_headlines: List[str] = []
    resolved_primary: List[str] = []
    resolved_desc: List[str] = []
    resolved_carousel_primary: List[str] = []
    resolved_carousel_headlines: List[str] = []
    resolved_carousel_desc: List[str] = []

    try:
        for h in headlines:
            resolved_headlines.append(_resolve_template(h, vars_map))
        for p in primary_texts:
            resolved_primary.append(_resolve_template(p, vars_map))
        for d in descriptions:
            resolved_desc.append(_resolve_template(d, vars_map))
        for h in carousel_headlines:
            resolved_carousel_headlines.append(_resolve_template(h, vars_map))
        for d in carousel_descriptions:
            resolved_carousel_desc.append(_resolve_template(d, vars_map))
    except Exception as exc:
        raise ValueError(f"Copy preset error: {exc}") from exc

    # Fallback to templates if empty
    if not resolved_headlines:
        resolved_headlines = [_resolve_template(copy_templates.headline_template(cfg.product_name), vars_map)]
    if not resolved_primary:
        resolved_primary = [_resolve_template(copy_templates.primary_text_template(cfg.product_url, cfg.product_name, cfg.brand_name), vars_map)]
    if not resolved_desc:
        resolved_desc = [_resolve_template(copy_templates.description_template(), vars_map)]
    resolved_carousel_primary = resolved_primary

    copy_block = {
        "headlines": resolved_headlines,
        "primary_texts": resolved_primary,
        "descriptions": resolved_desc,
        "carousel_primary_texts": resolved_carousel_primary,
        "carousel_headlines": resolved_carousel_headlines,
        "carousel_descriptions": resolved_carousel_desc,
        "url": cfg.product_url,
    }
    launch_date = date.today().isoformat()
    country_code = _normalize_country(cfg.country)
    daily_budget_value = int(cfg.daily_budget_minor or config.DAILY_BUDGET)

    results: List[Dict] = []
    total_ads_created = 0
    first_campaign_id = ""
    first_adset_id = ""
    # Basic validation for text assets
    if not (copy_block["headlines"] or copy_block["primary_texts"]):
        raise ValueError("At least one headline or primary text is required in the preset.")
    for field_name in ("headlines", "primary_texts", "descriptions"):
        if len(copy_block[field_name]) > 5:
            raise ValueError(f"{field_name} exceeds Meta limit of 5 entries.")

    for campaign in campaigns:
        use_existing = cfg.launch_type == "existing_campaign" and cfg.campaign_id
        campaign_name = (
            campaign["name"]
            if use_existing
            else f"{country_code} - {campaign['name']} - {launch_date}"
        )
        if use_existing:
            campaign_id = cfg.campaign_id
            _emit(logs, log_hook, f"Using existing campaign: {campaign_name} ({campaign_id})")
        else:
            _emit(logs, log_hook, f"Creating campaign: {campaign_name}")
            campaign_id = api.create_campaign(
                name=campaign_name,
                objective=config.OBJECTIVE,
                daily_budget=daily_budget_value,
                status=cfg.campaign_status or "PAUSED",
            )
            _emit(logs, log_hook, f"Created campaign: {campaign_name} ({campaign_id})")

        if not first_campaign_id:
            first_campaign_id = campaign_id or ""
        campaign_entry = {"campaign_name": campaign_name, "campaign_id": campaign_id, "adsets": []}

        # Existing campaign, creatives only: reuse target ad sets and do not create new ad sets.
        if use_existing and cfg.add_mode == "creatives_only":
            target_ids = cfg.target_adset_ids or []
            if not target_ids:
                raise ValueError("Target ad set IDs required when adding creatives to existing campaign.")
            flat_creatives = []
            for adset in campaign["adsets"]:
                flat_creatives.extend(adset["creatives"])
            for target_id in target_ids:
                adset_entry = {"adset_name": target_id, "adset_id": target_id, "ads_created": 0}
                _emit(logs, log_hook, f"  Adding creatives to ad set: {target_id}")
                for creative_item in flat_creatives:
                    if isinstance(creative_item, dict) and creative_item.get("type") == "carousel":
                        items = [Path(p) for p in creative_item.get("items", [])]
                        valid_items = [
                            p
                            for p in items
                            if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
                        ]
                        if len(valid_items) < 2:
                            _emit(logs, log_hook, f"    Skipping carousel '{creative_item.get('name')}' (needs >=2 images)")
                            continue
                        headline = copy_block["headlines"][0] if copy_block["headlines"] else ""
                        primary_text = resolved_carousel_primary[0] if resolved_carousel_primary else ""
                        description = copy_block["descriptions"][0] if copy_block["descriptions"] else ""
                        _emit(logs, log_hook, f"    Uploading carousel: {creative_item.get('name')} ({len(valid_items)} images)")
                        creative_id = api.create_carousel_creative(
                            file_paths=valid_items,
                            page_id=config.PAGE_ID,
                            product_url=cfg.product_url,
                            instagram_account_id=config.INSTAGRAM_ACCOUNT_ID,
                            primary_text=primary_text,
                            headline=headline,
                            description=description,
                            per_card_headlines=copy_block["carousel_headlines"],
                            per_card_descriptions=copy_block["carousel_descriptions"],
                        )
                        ad_name = f"{creative_item.get('name')}_carousel"
                        ad_id = api.create_ad(
                            name=ad_name,
                            adset_id=target_id,
                            creative_id=creative_id,
                            status="ACTIVE",
                        )
                        adset_entry["ads_created"] += 1
                        total_ads_created += 1
                        _emit(logs, log_hook, f"    Created carousel ad: {ad_name} ({ad_id})")
                        continue

                    file_path = Path(creative_item)
                    if not file_path.is_file():
                        _emit(logs, log_hook, f"    Skipping missing file: {file_path}")
                        continue
                    if file_path.name.startswith("."):
                        continue
                    if file_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".mp4", ".mov", ".m4v", ".avi"}:
                        _emit(logs, log_hook, f"    Unsupported file type, skipping: {file_path.name}")
                        continue
                    _emit(logs, log_hook, f"    Uploading creative: {file_path.name}")
                    creative_id = api.upload_media_and_create_creative(
                        file_path=file_path,
                        page_id=config.PAGE_ID,
                        product_url=cfg.product_url,
                        instagram_account_id=config.INSTAGRAM_ACCOUNT_ID,
                        primary_texts=copy_block["primary_texts"],
                        headlines=copy_block["headlines"],
                        descriptions=copy_block["descriptions"],
                    )
                    ad_name = file_path.stem
                    ad_id = api.create_ad(
                        name=ad_name,
                        adset_id=target_id,
                        creative_id=creative_id,
                        status="ACTIVE",
                    )
                    adset_entry["ads_created"] += 1
                    total_ads_created += 1
                    _emit(logs, log_hook, f"    Created ad: {ad_name} ({ad_id})")
                campaign_entry["adsets"].append(adset_entry)
            results.append(campaign_entry)
            continue

        for adset in campaign["adsets"]:
            targeting = dict(config.TARGETING)
            targeting["geo_locations"] = {"countries": [country_code]}
            adset_name = adset["name"]
            _emit(logs, log_hook, f"  Creating ad set: {adset_name}")
            adset_id = api.create_ad_set(
                name=adset_name,
                campaign_id=campaign_id,
                targeting=targeting,
                optimization_event=config.OPTIMIZATION_EVENT,
                pixel_id=config.PIXEL_ID,
                status=cfg.adset_status if cfg.adset_status in {"ACTIVE", "PAUSED"} else "ACTIVE",
                start_time=cfg.start_time_iso,
                multi_advertiser=cfg.multi_advertiser_ads,
            )
            if not first_adset_id:
                first_adset_id = adset_id or ""
            adset_entry = {"adset_name": adset_name, "adset_id": adset_id, "ads_created": 0}
            _emit(logs, log_hook, f"  Created ad set: {adset_name} ({adset_id})")

            for creative_item in adset["creatives"]:
                if isinstance(creative_item, dict) and creative_item.get("type") == "carousel":
                    items = [Path(p) for p in creative_item.get("items", [])]
                    valid_items = [
                        p
                        for p in items
                        if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
                    ]
                    if len(valid_items) < 2:
                        _emit(logs, log_hook, f"    Skipping carousel '{creative_item.get('name')}' (needs >=2 images)")
                        continue
                    _emit(logs, log_hook, f"    Uploading carousel: {creative_item.get('name')} ({len(valid_items)} images)")
                    headline = copy_block["headlines"][0] if copy_block["headlines"] else ""
                    primary_text = resolved_carousel_primary[0] if resolved_carousel_primary else ""
                    description = copy_block["descriptions"][0] if copy_block["descriptions"] else ""
                    creative_id = api.create_carousel_creative(
                        file_paths=valid_items,
                        page_id=config.PAGE_ID,
                        product_url=cfg.product_url,
                        instagram_account_id=config.INSTAGRAM_ACCOUNT_ID,
                        primary_text=primary_text,
                        headline=headline,
                        description=description,
                        per_card_headlines=copy_block["carousel_headlines"],
                        per_card_descriptions=copy_block["carousel_descriptions"],
                    )
                    ad_name = f"{creative_item.get('name')}_carousel"
                    ad_id = api.create_ad(
                        name=ad_name,
                        adset_id=adset_id,
                        creative_id=creative_id,
                        status="ACTIVE",
                    )
                    adset_entry["ads_created"] += 1
                    total_ads_created += 1
                    _emit(logs, log_hook, f"    Created carousel ad: {ad_name} ({ad_id})")
                    continue

                file_path = Path(creative_item)

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
                    primary_texts=copy_block["primary_texts"],
                    headlines=copy_block["headlines"],
                    descriptions=copy_block["descriptions"],
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
