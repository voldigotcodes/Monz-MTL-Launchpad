import json
from pathlib import Path
from typing import Dict

import requests
import time


class MetaAPI:
    def __init__(self, access_token: str, ad_account_id: str):
        self.access_token = access_token
        self.ad_account_id = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
        self.base_url = "https://graph.facebook.com/v18.0"

    def _post(self, endpoint: str, data: Dict = None, files=None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        payload = dict(data or {})
        payload["access_token"] = self.access_token
        response = requests.post(url, data=payload, files=files)
        if not response.ok:
            raise RuntimeError(f"Meta API error {response.status_code}: {response.text}")
        time.sleep(1.2)  # To avoid rate limiting
        return response.json()

    def _get(self, endpoint: str, params: Dict = None) -> Dict:
        url = f"{self.base_url}/{endpoint}"
        payload = dict(params or {})
        payload["access_token"] = self.access_token
        response = requests.get(url, params=payload)
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
        with file_path.open("rb") as video_file:
            files = {"source": video_file}
            result = self._post(f"{self.ad_account_id}/advideos", files=files)
        video_id = result.get("id")
        if not video_id:
            raise RuntimeError(f"Failed to upload video: {file_path}")
        return video_id

    def create_ad_creative_link(
        self,
        page_id: str,
        product_url: str,
        instagram_account_id: str | None,
        primary_text: str,
        headline: str,
        description: str,
        image_hash: str,
    ) -> str:
        final_url = f"{product_url}?tw_source={{site_source_name}}&tw_adid={{ad.id}}"
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
            "name": headline,
            "object_story_spec": json.dumps(object_story_spec),
        }
        result = self._post(f"{self.ad_account_id}/adcreatives", data=data)
        return result.get("id")

    def create_ad_creative_video(
        self,
        page_id: str,
        product_url: str,
        instagram_account_id: str | None,
        primary_text: str,
        headline: str,
        video_id: str,
        thumbnail_url: str,
    ) -> str:
        final_url = f"{product_url}?tw_source={{site_source_name}}&tw_adid={{ad.id}}"
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
        if instagram_account_id:
            object_story_spec["instagram_user_id"] = instagram_account_id
        data = {
            "name": headline,
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
        primary_text: str,
        headline: str,
        description: str,
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
                primary_text=primary_text,
                headline=headline,
                video_id=video_id,
                thumbnail_url=thumbnail_url,
            )
        print("Uploading image:", file_path.name, file_path.suffix.lower())
        image_hash = self.upload_image(file_path)
        return self.create_ad_creative_link(
            page_id=page_id,
            product_url=product_url,
            instagram_account_id=instagram_account_id,
            primary_text=primary_text,
            headline=headline,
            description=description,
            image_hash=image_hash,
        )
