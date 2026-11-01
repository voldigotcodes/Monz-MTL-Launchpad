import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from launcher import backend, config
from launcher import launch_core
from launcher.meta_assets import AssetDiscovery, image_url


SELECTION = {"businessId": "10", "adAccountId": "act_123", "pageId": "456", "instagramUserId": "777", "pixelId": "789"}


class DiscoveryTests(unittest.TestCase):
    def test_pagination_uses_fixed_endpoint_and_cursor_without_next_url(self):
        graph = Mock(side_effect=[
            {"data": [{"id": "1"}], "paging": {"next": "https://other.example/?access_token=secret", "cursors": {"after": "cursor"}}},
            {"data": [{"id": "2"}]},
        ])
        self.assertEqual(len(AssetDiscovery(graph).rows("me/adaccounts", "id")), 2)
        self.assertEqual(graph.call_args.args, ("me/adaccounts", {"fields": "id", "limit": 100, "after": "cursor"}))

    def test_repeated_pagination_cursor_is_rejected(self):
        graph = Mock(return_value={"data": [], "paging": {"next": "url", "cursors": {"after": "same"}}})
        with self.assertRaises(HTTPException):
            AssetDiscovery(graph).rows("me/adaccounts", "id")
        self.assertEqual(graph.call_count, 2)

    def test_business_owned_and_shared_accounts_are_deduplicated(self):
        graph = Mock(return_value={"data": [{"id": "act_1", "name": "Example", "account_status": 1, "access_token": "secret"}]})
        data = AssetDiscovery(graph).discover("ad-accounts", business="10")
        self.assertEqual(len(data["items"]), 1)
        self.assertNotIn("secret", json.dumps(data))
        self.assertEqual({call.args[0] for call in graph.call_args_list}, {"10/owned_ad_accounts", "10/client_ad_accounts"})

    def test_partial_business_results_have_warning(self):
        def graph(endpoint, params):
            if "client" in endpoint:
                raise HTTPException(403, {"code": "meta_rejected"})
            return {"data": [{"id": "act_1", "name": "Example"}]}
        data = AssetDiscovery(graph).discover("ad-accounts", business="10")
        self.assertEqual(len(data["items"]), 1)
        self.assertTrue(data["warnings"])

    def test_token_failure_is_not_hidden_as_partial_result(self):
        graph = Mock(side_effect=HTTPException(400, {"code": "token_rejected"}))
        with self.assertRaises(HTTPException) as raised:
            AssetDiscovery(graph).discover("ad-accounts", business="10")
        self.assertEqual(raised.exception.detail["code"], "token_rejected")

    def test_pages_are_filtered_through_account_promote_pages(self):
        graph = Mock(return_value={"data": [{"id": "456", "name": "Page", "picture": {"data": {"url": "https://example.com/avatar.jpg"}}, "access_token": "secret"}]})
        data = AssetDiscovery(graph).discover("pages", account="123")
        self.assertEqual(graph.call_args.args[0], "act_123/promote_pages")
        self.assertEqual(data["items"][0]["imageUrl"], "https://example.com/avatar.jpg")
        self.assertNotIn("secret", json.dumps(data))

    def test_page_linked_instagram_is_suggested_and_fields_are_public(self):
        def graph(endpoint, params):
            if endpoint == "456":
                return {"instagram_business_account": {"id": "777"}}
            return {"data": [{"id": "777", "username": "example", "profile_picture_url": "https://example.com/avatar.jpg", "access_token": "secret"}]}
        data = AssetDiscovery(graph).discover("instagram", account="123", page="456")
        self.assertEqual(data["items"][0]["username"], "example")
        self.assertTrue(data["items"][0]["linkedPage"])
        self.assertNotIn("secret", json.dumps(data))

    def test_page_linked_instagram_falls_back_when_account_edges_are_unavailable(self):
        def graph(endpoint, params):
            if endpoint.startswith("act_"):
                raise HTTPException(403, {"code": "meta_rejected"})
            if endpoint == "456":
                return {"instagram_business_account": {"id": "777"}}
            return {"id": "777", "username": "example"}
        data = AssetDiscovery(graph).discover("instagram", account="123", page="456")
        self.assertEqual(data["items"][0]["id"], "777")
        self.assertTrue(data["warnings"])

    def test_invalid_id_never_reaches_graph(self):
        graph = Mock()
        with self.assertRaises(HTTPException):
            AssetDiscovery(graph).discover("pixels", account="123/other")
        graph.assert_not_called()

    def test_permission_diagnostics_dont_expose_token(self):
        graph = Mock(return_value={"data": [{"permission": "ads_management", "status": "granted"}, {"permission": "instagram_basic", "status": "declined"}]})
        data = AssetDiscovery(graph).discover("permissions")
        self.assertEqual(data["granted"], ["ads_management"])
        self.assertIn("instagram_basic", data["missingSuggested"])

    def test_unsafe_image_links_are_omitted(self):
        for value in ["http://example.com/image", "javascript:alert(1)", "https://example.com/?access_token=secret", None]:
            self.assertIsNone(image_url(value))


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "assets.json"
        env = patch.dict(os.environ, {"LAUNCHPAD_ASSETS_PATH": str(self.path)})
        env.start()
        self.addCleanup(config.refresh)
        self.addCleanup(env.stop)
        self.client = TestClient(backend.app)

    def assets(self, kind, *args):
        key = {"businesses": "businessId", "ad-accounts": "adAccountId", "pages": "pageId", "pixels": "pixelId", "instagram": "instagramUserId"}[kind]
        return {"items": [{"id": SELECTION[key], "name": "Example", "status": 1}], "warnings": []}

    def test_selection_requires_compatible_assets_and_saves_only_ids(self):
        with patch.object(AssetDiscovery, "discover", side_effect=self.assets):
            result = self.client.put("/meta/assets/selection", json=SELECTION)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(json.loads(self.path.read_text()), SELECTION)
        self.assertEqual(result.json()["adAccountId"], "act_123")
        self.assertNotIn("accessToken", result.json())

    def test_inaccessible_pixel_does_not_replace_previous_selection(self):
        self.path.write_text(json.dumps(SELECTION))
        original = self.path.read_bytes()
        def assets(kind, *args):
            return {"items": [], "warnings": []} if kind == "pixels" else self.assets(kind)
        with patch.object(AssetDiscovery, "discover", side_effect=assets):
            result = self.client.put("/meta/assets/selection", json=SELECTION)
        self.assertEqual(result.status_code, 400)
        self.assertEqual(self.path.read_bytes(), original)

    def test_inactive_account_is_rejected(self):
        def assets(kind, *args):
            result = self.assets(kind)
            if kind == "ad-accounts":
                result["items"][0]["status"] = 2
            return result
        with patch.object(AssetDiscovery, "discover", side_effect=assets):
            response = self.client.put("/meta/assets/selection", json=SELECTION)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.path.exists())

    def test_extra_credential_field_is_rejected(self):
        result = self.client.put("/meta/assets/selection", json={**SELECTION, "accessToken": "secret"})
        self.assertEqual(result.status_code, 400)
        self.assertFalse(self.path.exists())

    def test_instagram_can_be_cleared_and_stays_cleared_after_refresh(self):
        selected = {**SELECTION, "instagramUserId": ""}
        with patch.object(AssetDiscovery, "discover", side_effect=self.assets):
            response = self.client.put("/meta/assets/selection", json=selected)
        self.assertEqual(response.status_code, 200)
        config.refresh()
        self.assertIsNone(config.INSTAGRAM_ACCOUNT_ID)

    def test_failed_atomic_replace_preserves_previous_selection(self):
        self.path.write_text(json.dumps(SELECTION))
        with patch.object(config.os, "replace", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                config.save_asset_selection({**SELECTION, "pixelId": "999"})
        self.assertEqual(json.loads(self.path.read_text()), SELECTION)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_job_payload_pins_selection_even_if_saved_ids_change_later(self):
        config.save_asset_selection(SELECTION)
        payload = backend._translate_launch_payload({"productUrl": "https://example.com"}, campaign_folder_path="/tmp/test")
        config.save_asset_selection({**SELECTION, "pixelId": "999"})
        config.refresh()
        self.assertEqual(payload["_meta_assets"]["pixelId"], "789")
        self.assertEqual(config.PIXEL_ID, "999")

    def test_launch_uses_captured_ids_instead_of_new_saved_selection(self):
        config.save_asset_selection({**SELECTION, "adAccountId": "act_999"})
        with patch.object(launch_core, "parse_launch_folder", return_value=[]), patch.object(launch_core, "LaunchAPI") as api:
            launch_core.run_launch({
                "campaign_folder_path": "/tmp/test", "product_url": "https://example.com",
                "product_name": "Example", "_meta_assets": SELECTION,
            })
        self.assertEqual(api.call_args.args[1], "act_123")


if __name__ == "__main__":
    unittest.main()
