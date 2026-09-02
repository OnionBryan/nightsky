"""Nightsky pure services — no Flask app / test_client."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "nightsky" / "backend"))

# Import shipped services module
from backend.nightsky_science import services  # noqa: E402


class TestNightskyServicesNoFlask(unittest.TestCase):
    def test_flask_server_not_imported(self):
        # Science hot path must not load nightsky Flask app module as `server`
        # (the old test_client path did `from server import app`).
        self.assertNotIn("server", sys.modules)
        import flask  # dependency may exist

        self.assertTrue(flask)

    def test_location_info(self):
        data, status = services.location_info(40.7128, -74.006)
        self.assertEqual(status, 200)
        self.assertIn("timezone", data)
        self.assertIn("is_night", data)
        self.assertIn("local_time", data)
        self.assertEqual(data["latitude"], 40.7128)

    def test_geo_look_angles(self):
        data, status = services.geostationary_lookup(40.7, -74.0, -75.2)
        self.assertEqual(status, 200)
        self.assertIn("elevation", data)
        self.assertIn("azimuth", data)
        self.assertTrue(data["visible"])

    def test_options(self):
        data, status = services.options()
        self.assertEqual(status, 200)
        self.assertIn("themes", data)
        self.assertIn("directions", data)

    def test_moon(self):
        data, status = services.moon(40.7, -74.0)
        self.assertEqual(status, 200)
        self.assertIn("phase", data)
        self.assertIn("name", data["phase"])
        self.assertIn("illumination", data["phase"])


if __name__ == "__main__":
    unittest.main()
