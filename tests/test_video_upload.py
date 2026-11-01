import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from launcher.meta_api import MetaAPI


class VideoUploadTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.video = Path(directory.name) / "v1.mp4"
        self.video.write_bytes(b"video bytes")
        self.api = MetaAPI("test-secret", "123")
        env = patch.dict(os.environ, {}, clear=True)
        env.start()
        self.addCleanup(env.stop)
        post = patch("launcher.meta_api.requests.post", return_value=Mock(ok=True, json=Mock(return_value={"id": "video1"})))
        self.post = post.start()
        self.addCleanup(post.stop)
        delay = patch("launcher.meta_api.time.sleep")
        delay.start()
        self.addCleanup(delay.stop)

    def test_video_uses_longer_send_and_response_timeout(self):
        self.assertEqual(self.api.upload_video(self.video), "video1")
        self.assertEqual(self.post.call_args.kwargs["timeout"], (600, 600))
        self.assertTrue(self.post.call_args.kwargs["files"]["source"].closed)
        self.assertTrue(self.post.call_args.args[0].endswith("/act_123/advideos"))

    def test_video_timeout_can_be_configured(self):
        os.environ["META_VIDEO_UPLOAD_TIMEOUT"] = "900"
        self.api.upload_video(self.video)
        self.assertEqual(self.post.call_args.kwargs["timeout"], (900, 900))
        self.assertEqual(self.api.timeout, (10, 120))

    def test_regular_api_calls_keep_the_original_timeout(self):
        self.api._post("act_123/ads", {"name": "Example"})
        self.assertEqual(self.post.call_args.kwargs["timeout"], (10, 120))

    def test_wrapped_write_timeout_is_clear_and_not_retried(self):
        self.post.side_effect = requests.ConnectionError("Connection aborted.", TimeoutError("write timed out test-secret"))
        with self.assertRaises(RuntimeError) as raised:
            self.api.upload_video(self.video)
        self.assertIn("v1.mp4", str(raised.exception))
        self.assertIn("META_VIDEO_UPLOAD_TIMEOUT", str(raised.exception))
        self.assertIn("media library before retrying", str(raised.exception))
        self.assertNotIn("test-secret", str(raised.exception))
        self.assertEqual(self.post.call_count, 1)
        self.assertTrue(self.post.call_args.kwargs["files"]["source"].closed)

    def test_response_timeout_also_has_clear_error(self):
        self.post.side_effect = requests.ReadTimeout("test-secret")
        with self.assertRaisesRegex(RuntimeError, "Video upload did not complete"):
            self.api.upload_video(self.video)
        self.assertEqual(self.post.call_count, 1)

    def test_invalid_configuration_does_not_send_video(self):
        for value in ("0", "-1", "nan", "inf", "invalid"):
            with self.subTest(value=value):
                os.environ["META_VIDEO_UPLOAD_TIMEOUT"] = value
                with self.assertRaisesRegex(ValueError, "positive number"):
                    self.api.upload_video(self.video)
        self.post.assert_not_called()

    def test_meta_api_rejection_is_not_mislabeled_as_network_failure(self):
        self.post.return_value = Mock(ok=False, status_code=400, text="Invalid video format")
        with self.assertRaisesRegex(RuntimeError, "Meta API error 400"):
            self.api.upload_video(self.video)
        self.assertEqual(self.post.call_count, 1)

    def test_missing_video_id_is_reported(self):
        self.post.return_value.json.return_value = {}
        with self.assertRaisesRegex(RuntimeError, "Failed to upload video"):
            self.api.upload_video(self.video)


if __name__ == "__main__":
    unittest.main()
