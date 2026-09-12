"""Verify the native smoke's authenticated byte transport on Linux before CI."""
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fixtures import FixtureServer, TOKEN


class FixtureTransportTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        Path(self.directory.name, "sample.mp4").write_bytes(bytes(range(256)))
        self.server = FixtureServer(self.directory.name, port=0)
        self.server.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.directory.cleanup()

    def read(self, path, **headers):
        return urlopen(Request(self.base + path, headers=headers), timeout=3)

    def test_authentication_and_ranges_are_required_and_audited(self):
        with self.assertRaises(HTTPError) as failure:
            self.read("/api/media/remote-mp4", Range="bytes=0-1")
        self.assertEqual(failure.exception.code, 401)
        with self.read("/api/media/remote-mp4", Authorization=f"Bearer {TOKEN}", Range="bytes=30-59") as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers["Content-Type"], "video/mp4")
            self.assertEqual(response.headers["Content-Range"], "bytes 30-59/256")
            self.assertEqual(response.read(), bytes(range(30, 60)))
        self.assertEqual(self.server.requests[-1]["responseStatus"], 206)
        self.assertTrue(self.server.requests[-1]["authorized"])
        self.assertNotIn(TOKEN, json.dumps(self.server.requests))

    def test_missing_permissions_and_network_failure_stay_distinct(self):
        for identifier, expected in [("remote-denied", 403), ("remote-offline", 503)]:
            with self.assertRaises(HTTPError) as failure:
                self.read(f"/api/media/{identifier}", Authorization=f"Bearer {TOKEN}")
            self.assertEqual(failure.exception.code, expected)
        self.assertEqual(self.server.transcodes, {})

    def test_range_beyond_file_is_rejected(self):
        with self.assertRaises(HTTPError) as failure:
            self.read("/api/media/remote-mp4", Authorization=f"Bearer {TOKEN}", Range="bytes=256-")
        self.assertEqual(failure.exception.code, 416)
        self.assertEqual(failure.exception.headers["Content-Range"], "bytes */256")


if __name__ == "__main__":
    unittest.main()
