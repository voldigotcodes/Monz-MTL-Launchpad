"""Read-only Meta discovery and validated local asset selection."""
from concurrent.futures import ThreadPoolExecutor
import re
from urllib.parse import urlparse

from fastapi import APIRouter, Body, HTTPException

from launcher import config


def numeric_id(value: str, *, account: bool = False, optional: bool = False) -> str:
    if optional and not value:
        return ""
    raw = value.removeprefix("act_") if account else value
    if not re.fullmatch(r"[0-9]+", raw):
        raise HTTPException(400, "Invalid Meta asset ID.")
    return f"act_{raw}" if account else raw


def image_url(value) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    # Profile-image links are public display data. Never return a token-bearing URL.
    if parsed.scheme != "https" or not parsed.netloc or "access_token" in value.lower():
        return None
    return value


class AssetDiscovery:
    def __init__(self, graph):
        self.graph = graph

    def rows(self, endpoint: str, fields: str) -> list[dict]:
        params = {"fields": fields, "limit": 100}
        result = []
        seen = set()
        for _ in range(50):
            data = self.graph(endpoint, params)
            rows = data.get("data")
            if not isinstance(rows, list):
                raise HTTPException(502, "Meta returned an invalid asset list.")
            result.extend(row for row in rows if isinstance(row, dict))
            paging = data.get("paging") or {}
            if not paging.get("next"):
                return result
            # Follow cursors on our fixed endpoint, never Meta's token-bearing next URL.
            after = (paging.get("cursors") or {}).get("after")
            if not after or after in seen:
                raise HTTPException(502, "Meta returned an invalid pagination cursor. Refresh the asset list.")
            seen.add(after)
            params = {**params, "after": after}
        raise HTTPException(422, "Too many assets to list. Select a business to narrow the results.")

    def combine(self, endpoints: list[str], fields: str) -> tuple[list[dict], list[str]]:
        items, warnings = {}, []
        def read(endpoint):
            try:
                return self.rows(endpoint, fields), None
            except HTTPException as error:
                if isinstance(error.detail, dict) and error.detail.get("code") in {"token_missing", "token_rejected", "meta_unreachable"}:
                    raise
                return [], error
        with ThreadPoolExecutor(max_workers=2) as pool:
            for rows, error in pool.map(read, endpoints):
                if error:
                    warnings.append("Some assets could not be read. Check business_management and assigned asset access.")
                for row in rows:
                    if row.get("id"):
                        items[str(row["id"])] = row
        if len(warnings) == len(endpoints):
            raise HTTPException(403, "Assets could not be listed. Check the token permissions and business assignments.")
        return list(items.values()), list(dict.fromkeys(warnings))

    def discover(self, kind: str, business: str = "", account: str = "", page: str = "") -> dict:
        warnings = []
        if kind == "permissions":
            rows = self.rows("me/permissions", "permission,status")
            granted = sorted(str(r["permission"]) for r in rows if r.get("status") == "granted" and r.get("permission"))
            suggested = [p for p in ["ads_management", "business_management", "pages_show_list", "pages_read_engagement", "instagram_basic"] if p not in granted]
            return {"items": [], "warnings": [], "granted": granted, "missingSuggested": suggested}
        if kind == "businesses":
            rows = self.rows("me/businesses", "id,name,profile_picture_uri")
        elif kind == "ad-accounts":
            fields = "id,name,account_status,currency,business{id,name}"
            if business:
                business = numeric_id(business)
                rows, warnings = self.combine([f"{business}/owned_ad_accounts", f"{business}/client_ad_accounts"], fields)
            else:
                rows = self.rows("me/adaccounts", fields)
        elif kind == "pages":
            account = numeric_id(account, account=True)
            rows = self.rows(f"{account}/promote_pages", "id,name,picture{url},tasks")
        elif kind == "pixels":
            account = numeric_id(account, account=True)
            rows = self.rows(f"{account}/adspixels", "id,name")
        elif kind == "instagram":
            account, page = numeric_id(account, account=True), numeric_id(page)
            fields = "id,name,username,profile_picture_url"
            try:
                rows, warnings = self.combine([f"{account}/instagram_accounts", f"{account}/connected_instagram_accounts"], fields)
            except HTTPException as error:
                if error.status_code != 403:
                    raise
                rows, warnings = [], ["Ad-account Instagram lists are unavailable; checking the Page-linked account."]
            linked = self.graph(page, {"fields": "instagram_business_account{id}"}).get("instagram_business_account") or {}
            linked_id = str(linked.get("id") or "")
            for row in rows:
                row["linkedPage"] = str(row.get("id")) == linked_id
            # A Page-linked identity is valid for that promotable Page, even if the account edge omits it.
            if linked_id and not any(str(row.get("id")) == linked_id for row in rows):
                try:
                    profile = self.graph(linked_id, {"fields": fields})
                except HTTPException:
                    profile = {"id": linked_id, "name": "Linked Instagram account"}
                    warnings.append("Instagram profile details are unavailable. Check instagram_basic permission.")
                rows.append({**profile, "linkedPage": True})
        else:
            raise HTTPException(400, "Unknown asset type.")
        items = []
        for row in rows:
            asset_id = str(row.get("id") or "")
            if not asset_id:
                continue
            business_info = row.get("business") or {}
            item = {"id": asset_id, "name": str(row.get("name") or row.get("username") or asset_id)}
            if kind == "ad-accounts":
                item.update(currency=row.get("currency"), status=row.get("account_status"), businessName=business_info.get("name"))
            if kind == "instagram":
                item.update(username=row.get("username"), linkedPage=bool(row.get("linkedPage")))
            picture = (row.get("picture") or {}).get("data") or {}
            url = image_url(row.get("profile_picture_url") or row.get("profile_picture_uri") or picture.get("url"))
            if url:
                item["imageUrl"] = url
            items.append(item)
        return {"items": sorted(items, key=lambda x: x["name"].casefold()), "warnings": list(dict.fromkeys(warnings))}

    def validate(self, values: dict) -> dict:
        keys = {"businessId", "adAccountId", "pageId", "instagramUserId", "pixelId"}
        if set(values) != keys or any(not isinstance(value, str) for value in values.values()):
            raise HTTPException(400, "Select a business (optional), ad account, Page, Instagram (optional), and pixel.")
        selected = {key: numeric_id(value.strip(), account=key == "adAccountId", optional=key in {"businessId", "instagramUserId"}) for key, value in values.items()}
        def require(kind, key):
            result = self.discover(kind, selected["businessId"], selected["adAccountId"], selected["pageId"])
            found = next((item for item in result["items"] if item["id"] == selected[key]), None)
            if not found:
                raise HTTPException(400, f"The selected {kind} asset is no longer accessible. Refresh and select again.")
            return found
        if selected["businessId"]:
            require("businesses", "businessId")
        account = require("ad-accounts", "adAccountId")
        if account.get("status") != 1:
            raise HTTPException(400, "Select an active ad account before saving.")
        require("pages", "pageId")
        require("pixels", "pixelId")
        if selected["instagramUserId"]:
            require("instagram", "instagramUserId")
        return selected


def asset_router(graph, current_settings):
    router = APIRouter(prefix="/meta")
    discovery = AssetDiscovery(graph)

    @router.get("/assets")
    def list_assets(kind: str, businessId: str = "", adAccountId: str = "", pageId: str = ""):
        return discovery.discover(kind, businessId, adAccountId, pageId)

    @router.put("/assets/selection")
    def save_selection(values: dict = Body(...)):
        selected = discovery.validate(values)
        try:
            config.save_asset_selection(selected)
        except OSError:
            raise HTTPException(500, "Could not save asset selection. Your previous selection is unchanged.") from None
        return current_settings()

    return router
