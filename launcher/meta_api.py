import os
import json
import math
from pathlib import Path
from typing import Dict

import requests
import time


DEFAULT_TIMEOUT: tuple[float, float] = (10.0, 120.0)
DEFAULT_VIDEO_UPLOAD_TIMEOUT = 600.0
DEFAULT_GRAPH_API_VERSION = "v18.0"


class MetaAPI:
    VIDEO_DATA_ALLOWED_FIELDS = frozenset(
        {
            "video_id",
            "image_url",
            "message",
            "title",
            "call_to_action",
        }
    )

    def __init__(
        self,
        access_token: str,
        ad_account_id: str,
        timeout: tuple[float, float] | float = DEFAULT_TIMEOUT,
        graph_api_version: str | None = None,
    ):
        self.access_token = access_token
        self.ad_account_id = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
        version = self._normalize_graph_version(graph_api_version or os.environ.get("META_GRAPH_API_VERSION"))
        self.base_url = f"https://graph.facebook.com/{version}"
        self.timeout = timeout

    @staticmethod
    def _normalize_graph_version(value: str | None) -> str:
        raw = (value or "").strip() or DEFAULT_GRAPH_API_VERSION
        return raw if raw.startswith("v") else f"v{raw}"

    @classmethod
    def _sanitize_video_data(cls, video_data: Dict | None) -> Dict:
        sanitized: Dict = {}
        for key, value in (video_data or {}).items():
            if key in cls.VIDEO_DATA_ALLOWED_FIELDS and value is not None:
                sanitized[key] = value
        if "video_id" not in sanitized:
            raise ValueError("video_data requires 'video_id'.")
        return sanitized

    @staticmethod
    def _with_tracking_params(url: str) -> str:
        """
        Append tracking macros used by the launcher.
        Avoid duplicating if the URL already includes tw_source/tw_adid.
        """
        raw = (url or "").strip()
        if not raw:
            return raw
        if "tw_source=" in raw or "tw_adid=" in raw:
            return raw
        sep = "&" if "?" in raw else "?"
        return f"{raw}{sep}tw_source={{site_source_name}}&tw_adid={{ad.id}}"

    def _post(self, endpoint: str, data: Dict = None, files=None, *, timeout=None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        payload = dict(data or {})
        payload["access_token"] = self.access_token
        response = requests.post(url, data=payload, files=files, timeout=self.timeout if timeout is None else timeout)
        if not response.ok:
            raise RuntimeError(f"Meta API error {response.status_code}: {response.text}")
        time.sleep(1.2)  # To avoid rate limiting
        return response.json()

    def _get(self, endpoint: str, params: Dict = None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        payload = dict(params or {})
        payload["access_token"] = self.access_token
        response = requests.get(url, params=payload, timeout=self.timeout)
        if not response.ok:
            raise RuntimeError(f"Meta API error {response.status_code}: {response.text}")
        time.sleep(1.2)  # To avoid rate limiting
        return response.json()

    def create_campaign(
        self,
        name: str,
        objective: str,
        daily_budget: int,
        status: str = "PAUSED",
    ) -> str:
        data = {
            "name": name,
            "objective": objective,
            "status": status,
            "special_ad_categories": "[]",
            "daily_budget": str(daily_budget),
            "is_campaign_budget_optimization": "true",
            "buying_type": "AUCTION",
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
        }
        result = self._post(f"{self.ad_account_id}/campaigns", data=data)
        return result.get("id")

    def create_ad_set(
        self,
        name: str,
        campaign_id: str,
        targeting: Dict,
        optimization_event: str,
        pixel_id: str,
        status: str = "PAUSED",
        start_time: str | None = None,
        multi_advertiser: bool = False,
    ) -> str:
        promoted_object = {"pixel_id": pixel_id, "custom_event_type": "PURCHASE"}
        data = {
            "name": name,
            "campaign_id": campaign_id,
            "status": status,
            "billing_event": "IMPRESSIONS",
            "optimization_goal": optimization_event,
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
            "promoted_object": json.dumps(promoted_object),
            "attribution_spec": json.dumps([
                {"event_type": "CLICK_THROUGH", "window_days": 7},
                {"event_type": "VIEW_THROUGH", "window_days": 1}
            ]),
            "targeting": json.dumps(targeting),
            "destination_type": "WEBSITE",
            "is_advantage_plus_audience": "true",
            "multi_advertiser": multi_advertiser,
        }
        if start_time:
            data["start_time"] = start_time
        result = self._post(f"{self.ad_account_id}/adsets", data=data)
        return result.get("id")

    def upload_image(self, file_path: Path) -> str:
        url = f"{self.base_url}/{self.ad_account_id}/adimages"

        with open(file_path, "rb") as image_file:
            response = requests.post(
                url,
                files={"file": image_file},
                data={"access_token": self.access_token},
                timeout=self.timeout,
            )

        if not response.ok:
            raise RuntimeError(
                f"Meta API error {response.status_code}: {response.text}"
            )

        images = response.json().get("images", {})
        image_info = next(iter(images.values()), {})
        image_hash = image_info.get("hash")

        if not image_hash:
            raise RuntimeError(f"Failed to upload image: {file_path}")

        return image_hash

    def upload_video(self, file_path: Path) -> str:
        try:
            upload_timeout = float(os.environ.get("META_VIDEO_UPLOAD_TIMEOUT", str(DEFAULT_VIDEO_UPLOAD_TIMEOUT)))
        except ValueError:
            raise ValueError("META_VIDEO_UPLOAD_TIMEOUT must be a positive number of seconds.") from None
        if not math.isfinite(upload_timeout) or upload_timeout <= 0:
            raise ValueError("META_VIDEO_UPLOAD_TIMEOUT must be a positive number of seconds.")
        try:
            with file_path.open("rb") as video_file:
                # urllib3 retains the connect/socket timeout while sending the request body.
                # Raising only the response timeout would leave video writes at 10 seconds.
                result = self._post(
                    f"{self.ad_account_id}/advideos", files={"source": video_file},
                    timeout=(upload_timeout, upload_timeout),
                )
        except (requests.RequestException, TimeoutError, ConnectionError):
            raise RuntimeError(
                f"Video upload did not complete for {file_path.name}: the connection timed out or was interrupted "
                f"(upload socket timeout: {upload_timeout:g}s). Check your connection; increase "
                "META_VIDEO_UPLOAD_TIMEOUT for slow uploads. Meta may already have received the video; "
                "check its media library before retrying."
            ) from None
        video_id = result.get("id")
        if not video_id:
            raise RuntimeError(f"Failed to upload video: {file_path}")
        return video_id

    @staticmethod
    def to_meta_assets(texts: list[str]) -> list[dict]:
        return [{"text": t} for t in texts if t and str(t).strip()][:5]

    @staticmethod
    def _use_asset_feed(headlines: list[str], primary_texts: list[str], descriptions: list[str]) -> bool:
        return len(headlines) > 1 or len(primary_texts) > 1 or len(descriptions) > 1

    def create_ad_creative_asset_feed(
        self,
        page_id: str,
        instagram_user_id: str | None,
        destination_url: str,
        image_hash: str,
        headlines: list[str],
        primary_texts: list[str],
        descriptions: list[str],
        creative_name: str,
    ) -> str:
        # Defensive validation
        if not destination_url or not isinstance(destination_url, str) or not destination_url.startswith("http"):
            raise ValueError("Destination URL is missing or invalid for asset feed creative.")
        if not image_hash:
            raise ValueError("Image hash is required for asset feed creative.")
        if not page_id:
            raise ValueError("Page ID is required for asset feed creative.")
        if not instagram_user_id:
            raise ValueError("Instagram user ID is required for asset feed creative.")

        final_url = self._with_tracking_params(destination_url)

        asset_feed_spec = {
            "optimization_type": "DEGREES_OF_FREEDOM",
            "ad_formats": ["SINGLE_IMAGE"],
            "call_to_action_types": ["SHOP_NOW"],
            "link_urls": [{"website_url": final_url}],
            "images": [{"hash": image_hash}],
            "titles": self.to_meta_assets(headlines),
            "bodies": self.to_meta_assets(primary_texts),
            "descriptions": self.to_meta_assets(descriptions),
        }

        # Meta requires a `link` field even when using `asset_feed_spec`.
        # Also include `image_hash` in `link_data` so the creative has a concrete media fallback.
        object_story_spec = {
            "page_id": page_id,
            "link_data": {
                "link": final_url,
                "image_hash": image_hash,
                "call_to_action": {"type": "SHOP_NOW", "value": {"link": final_url}},
                "message": (primary_texts[0] if primary_texts else ""),
                "name": (headlines[0] if headlines else creative_name or "Creative"),
                "description": (descriptions[0] if descriptions else ""),
            },
        }
        if instagram_user_id:
            object_story_spec["instagram_user_id"] = instagram_user_id

        data = {
            "name": creative_name or "Creative",
            "object_story_spec": json.dumps(object_story_spec),
            "asset_feed_spec": json.dumps(asset_feed_spec),
        }
        try:
            result = self._post(f"{self.ad_account_id}/adcreatives", data=data)
        except RuntimeError as exc:
            # include payload for debugging
            raise RuntimeError(f"{exc} | payload={json.dumps(data)}")
        return result.get("id")

    def create_ad_creative_link(
        self,
        page_id: str,
        product_url: str,
        instagram_account_id: str | None,
        headline: str,
        primary_text: str,
        description: str,
        image_hash: str,
    ) -> str:
        final_url = self._with_tracking_params(product_url)
        object_story_spec = {
            "page_id": page_id,
            "link_data": {
                "call_to_action": {"type": "SHOP_NOW", "value": {"link": final_url}},
                "image_hash": image_hash,
                "link": final_url,
                "message": primary_text,
                "name": headline,
                "description": description,
            },
        }
        if instagram_account_id:
            object_story_spec["instagram_user_id"] = instagram_account_id
        data = {
            "name": headline or "Creative",
            "object_story_spec": json.dumps(object_story_spec),
        }

        result = self._post(f"{self.ad_account_id}/adcreatives", data=data)
        return result.get("id")

    def create_ad_creative_video(
        self,
        page_id: str,
        product_url: str,
        instagram_account_id: str | None,
        headlines: list[str],
        primary_texts: list[str],
        descriptions: list[str],
        video_id: str,
        thumbnail_url: str,
    ) -> str:
        final_url = self._with_tracking_params(product_url)
        headline_assets = self.to_meta_assets(headlines)
        primary_assets = self.to_meta_assets(primary_texts)
        description_assets = self.to_meta_assets(descriptions)

        use_asset_feed = self._use_asset_feed(headlines, primary_texts, descriptions)

        if use_asset_feed:
            # Include a concrete video on the story spec so Ads Manager renders media reliably.
            # The asset feed still provides multiple text variants.
            object_story_spec = {
                "page_id": page_id,
                "video_data": {
                    "video_id": video_id,
                    "image_url": thumbnail_url,
                    "message": primary_texts[0] if primary_texts else "",
                    "title": headlines[0] if headlines else "",
                    "call_to_action": {"type": "SHOP_NOW", "value": {"link": final_url}},
                },
            }
            # Enforce an allowlist so unsupported video_data fields never reach Meta.
            object_story_spec["video_data"] = self._sanitize_video_data(object_story_spec["video_data"])
            if instagram_account_id:
                object_story_spec["instagram_user_id"] = instagram_account_id

            asset_feed_spec = {
                "optimization_type": "DEGREES_OF_FREEDOM",
                "ad_formats": ["SINGLE_VIDEO"],
                "call_to_action_types": ["SHOP_NOW"],
                "link_urls": [{"website_url": final_url}],
                "videos": [{"video_id": video_id, "thumbnail_url": thumbnail_url}],
                "titles": headline_assets,
                "bodies": primary_assets,
                "descriptions": description_assets,
            }
            data = {
                "name": headline_assets[0]["text"] if headline_assets else "Creative",
                "object_story_spec": json.dumps(object_story_spec),
                "asset_feed_spec": json.dumps(asset_feed_spec),
            }
        else:
            headline = headlines[0] if headlines else ""
            primary_text = primary_texts[0] if primary_texts else ""
            object_story_spec = {
                "page_id": page_id,
                "video_data": {
                    "video_id": video_id,
                    "image_url": thumbnail_url,
                    "message": primary_text,
                    "title": headline,
                    "call_to_action": {"type": "SHOP_NOW", "value": {"link": final_url}},
                },
            }
            object_story_spec["video_data"] = self._sanitize_video_data(object_story_spec["video_data"])
            if instagram_account_id:
                object_story_spec["instagram_user_id"] = instagram_account_id
            data = {
                "name": headline or "Creative",
                "object_story_spec": json.dumps(object_story_spec),
            }
        result = self._post(f"{self.ad_account_id}/adcreatives", data=data)
        return result.get("id")

    def create_ad(self, name: str, adset_id: str, creative_id: str, status: str = "PAUSED") -> str:
        creative = {"creative_id": creative_id}
        data = {
            "name": name,
            "adset_id": adset_id,
            "status": status,
            "creative": json.dumps(creative),
        }
        result = self._post(f"{self.ad_account_id}/ads", data=data)
        return result.get("id")

    def upload_media_and_create_creative(
        self,
        file_path: Path,
        page_id: str,
        product_url: str,
        instagram_account_id: str,
        headlines: list[str],
        primary_texts: list[str],
        descriptions: list[str],
    ) -> str:
        extension = file_path.suffix.lower()
        if extension in {".mp4", ".mov", ".avi", ".m4v"}:
            video_id = self.upload_video(file_path)
            time.sleep(1.2)
            self._post(f"{video_id}/thumbnails")
            time.sleep(1.2)
            thumbnail_result = self._get(f"{video_id}/thumbnails")
            thumbnails = thumbnail_result.get("data") or []
            first_thumbnail = thumbnails[0] if thumbnails else {}
            thumbnail_url = first_thumbnail.get("uri")
            if not thumbnail_url:
                raise RuntimeError(f"No thumbnail URI available for video {video_id}")
            time.sleep(1.2)
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
        print("Uploading image:", file_path.name, file_path.suffix.lower())
        image_hash = self.upload_image(file_path)
        return self.create_ad_creative_link(
            page_id=page_id,
            product_url=product_url,
            instagram_account_id=instagram_account_id,
            headline=headlines[0] if headlines else "",
            primary_text=primary_texts[0] if primary_texts else "",
            description=descriptions[0] if descriptions else "",
            image_hash=image_hash,
        )
