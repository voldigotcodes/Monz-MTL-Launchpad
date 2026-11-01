import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from fastapi.testclient import TestClient

from launcher import backend, config


class MetaConnectionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.selection_path = str(Path(directory.name) / "assets.json")
        environment = patch.dict("os.environ", {"LAUNCHPAD_ASSETS_PATH": self.selection_path})
        environment.start()
        self.addCleanup(environment.stop)
        self.settings = patch.multiple(
            config, ACCESS_TOKEN="test-secret-token", AD_ACCOUNT_ID="act_123",
            PAGE_ID="456", PIXEL_ID="789", INSTAGRAM_ACCOUNT_ID=None,
        )
        self.settings.start()
        refresh = patch.object(config, "refresh")
        refresh.start()
        self.addCleanup(refresh.stop)
        self.addCleanup(self.settings.stop)
        self.client = TestClient(backend.app)
        self.graph = patch.object(backend.requests, "get")
        self.get = self.graph.start()
        self.addCleanup(self.graph.stop)

    def response(self, data, status=200):
        return Mock(ok=status < 400, status_code=status, json=Mock(return_value=data))

    def test_config_exposes_status_and_ids_only(self):
        response = self.client.get("/meta/config")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "tokenConfigured": True, "businessId": "", "adAccountId": "act_123", "pageId": "456",
            "pixelId": "789", "instagramUserId": "",
        })
        self.assertNotIn(config.ACCESS_TOKEN, response.text)
        self.get.assert_not_called()

    def test_success_checks_user_and_normalized_account(self):
        config.AD_ACCOUNT_ID = "123"
        self.get.side_effect = [
            self.response({"id": "user1", "name": "Operator", "access_token": config.ACCESS_TOKEN}),
            self.response({"id": "act_123", "name": "Ads", "account_status": 1}),
        ]
        response = self.client.get("/meta/connection")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["adAccount"], {"id": "act_123", "name": "Ads", "status": 1})
        self.assertNotIn(config.ACCESS_TOKEN, response.text)
        calls = self.get.call_args_list
        self.assertTrue(calls[0].args[0].endswith("/me"))
        self.assertTrue(calls[1].args[0].endswith("/act_123"))
        self.assertEqual(calls[0].kwargs["headers"], {"Authorization": "Bearer test-secret-token"})
        self.assertNotIn("access_token", calls[0].kwargs["params"])

    def test_missing_token_is_reported_without_calling_meta(self):
        config.ACCESS_TOKEN = ""
        self.assertFalse(self.client.get("/meta/config").json()["tokenConfigured"])
        response = self.client.get("/meta/connection")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "token_missing")
        self.get.assert_not_called()

    def test_missing_or_invalid_account_is_reported_without_calling_meta(self):
        for account in ("", "act_", "act_123/other", "abc"):
            with self.subTest(account=account):
                config.AD_ACCOUNT_ID = account
                response = self.client.get("/meta/connection")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"]["code"], "account_missing_or_invalid")
        self.get.assert_not_called()

    def test_rejected_token_does_not_leak_meta_response(self):
        self.get.return_value = self.response({
            "error": {"code": 190, "message": config.ACCESS_TOKEN},
        }, 400)
        response = self.client.get("/meta/connection")
        self.assertEqual(response.json()["detail"]["code"], "token_rejected")
        self.assertNotIn(config.ACCESS_TOKEN, response.text)

    def test_inaccessible_account_is_distinct_from_rejected_token(self):
        self.get.side_effect = [
            self.response({"id": "user1"}),
            self.response({"error": {"code": 100}}, 403),
        ]
        response = self.client.get("/meta/connection")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "account_inaccessible")

    def test_network_failures_do_not_leak_request_details(self):
        for error in (requests.Timeout(config.ACCESS_TOKEN), requests.ConnectionError(config.ACCESS_TOKEN)):
            with self.subTest(error=type(error).__name__):
                self.get.side_effect = error
                response = self.client.get("/meta/connection")
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json()["detail"]["code"], "meta_unreachable")
                self.assertNotIn(config.ACCESS_TOKEN, response.text)

    def test_invalid_meta_json_is_handled(self):
        self.get.return_value = Mock(json=Mock(side_effect=ValueError("invalid JSON")))
        response = self.client.get("/meta/connection")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"]["code"], "meta_invalid_response")

    def test_campaign_listing_uses_same_account_and_token(self):
        self.get.return_value = self.response({"data": [{"id": "campaign1"}]})
        response = self.client.get("/meta/campaigns")
        self.assertEqual(response.json(), [{"id": "campaign1"}])
        self.assertTrue(self.get.call_args.args[0].endswith("/act_123/campaigns"))
        self.assertEqual(self.get.call_args.kwargs["headers"]["Authorization"], "Bearer test-secret-token")

    def test_launch_validation_rejects_incomplete_config(self):
        config.require_meta_settings()
        config.PIXEL_ID = ""
        with self.assertRaisesRegex(ValueError, "META_PIXEL_ID"):
            config.require_meta_settings()

    def test_missing_env_does_not_prevent_configuration_startup(self):
        with patch.dict("os.environ", {"LAUNCHPAD_ASSETS_PATH": self.selection_path}, clear=True), patch.object(Path, "read_text", return_value=""):
            loaded = runpy.run_path(str(Path(config.__file__)))
        self.assertEqual(loaded["ACCESS_TOKEN"], "")
        self.assertEqual(loaded["AD_ACCOUNT_ID"], "")
        with self.assertRaisesRegex(ValueError, "META_ACCESS_TOKEN"):
            loaded["require_meta_settings"]()

    def test_refresh_picks_up_changed_dotenv_token(self):
        with patch.dict("os.environ", {"LAUNCHPAD_ASSETS_PATH": self.selection_path}, clear=True), patch.object(
            Path, "read_text", return_value="META_ACCESS_TOKEN=first-test-token\nMETA_AD_ACCOUNT_ID=123"
        ) as read:
            loaded = runpy.run_path(str(Path(config.__file__)))
            refresh = loaded["refresh"]
            self.assertEqual(refresh.__globals__["ACCESS_TOKEN"], "first-test-token")
            read.return_value = "META_ACCESS_TOKEN=second-test-token\nMETA_AD_ACCOUNT_ID=123"
            refresh()
            self.assertEqual(refresh.__globals__["ACCESS_TOKEN"], "second-test-token")
            read.return_value = "META_AD_ACCOUNT_ID=123"
            refresh()
            self.assertEqual(refresh.__globals__["ACCESS_TOKEN"], "")

    def test_process_environment_still_overrides_dotenv(self):
        with patch.dict("os.environ", {"META_ACCESS_TOKEN": "process-test-token", "LAUNCHPAD_ASSETS_PATH": self.selection_path}, clear=True), patch.object(
            Path, "read_text", return_value="META_ACCESS_TOKEN=file-test-token"
        ):
            loaded = runpy.run_path(str(Path(config.__file__)))
            loaded["refresh"]()
            self.assertEqual(loaded["refresh"].__globals__["ACCESS_TOKEN"], "process-test-token")

    def test_config_endpoint_refreshes_before_reading(self):
        self.client.get("/meta/config")
        config.refresh.assert_called_once()

    def test_launch_payload_rejects_missing_config_before_job_is_started(self):
        config.ACCESS_TOKEN = ""
        with self.assertRaisesRegex(backend.HTTPException, "META_ACCESS_TOKEN"):
            backend._translate_launch_payload({"productUrl": "https://example.com"}, campaign_folder_path="/tmp/test")

    def test_migrated_upload_preview_and_job_routes_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"LAUNCHPAD_UPLOAD_ROOT": directory}
        ):
            upload = self.client.post("/uploads", files={
                "files": ("Campaign/Adset/creative.jpg", b"test-image", "image/jpeg"),
            })
            self.assertEqual(upload.status_code, 200)
            upload_id = upload.json()["upload_id"]
            self.addCleanup(backend._UPLOADS.pop, upload_id, None)
            with patch.object(backend, "build_preview", return_value={"total_ads": 1}):
                preview = self.client.get(f"/uploads/{upload_id}/preview")
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview.json()["total_ads"], 1)
            with patch.object(backend.threading, "Thread") as thread:
                job = self.client.post("/launch/jobs", json={
                    "uploadId": upload_id, "productUrl": "https://example.com",
                })
                self.assertEqual(job.status_code, 200)
                thread.return_value.start.assert_called_once()
            job_id = job.json()["job_id"]
            self.addCleanup(backend._JOBS.pop, job_id, None)
            poll = self.client.get(f"/launch/jobs/{job_id}?after=0")
            self.assertEqual(poll.status_code, 200)
            self.assertEqual(poll.json()["status"], "pending")
        self.get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
